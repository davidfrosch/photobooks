import * as THREE from 'https://unpkg.com/three@0.158.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.158.0/examples/jsm/controls/OrbitControls.js';
import { Tween, Easing, update as TWEENUpdate } from 'https://cdn.jsdelivr.net/npm/@tweenjs/tween.js@18.6.4/dist/tween.esm.js';

// global contrast factor: <1 reduces contrast, >1 increases. 1 = no change
const GLOBAL_CONTRAST = 0.9;
// Feature flag: default forced mobile behavior; set to false to allow normal detection
const FORCE_MOBILE = true;

// Utility: create a new CanvasTexture with adjusted contrast from a source image/texture
function createContrastCanvasTexture(srcTexture, contrast = GLOBAL_CONTRAST) {
  if (!srcTexture || !srcTexture.image) return srcTexture;
  const img = srcTexture.image;
  const w = img.width || 1024;
  const h = img.height || 1024;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  try {
    ctx.drawImage(img, 0, 0, w, h);
    const id = ctx.getImageData(0, 0, w, h);
    const data = id.data;
    // contrast algorithm: new = 128 + contrast*(old - 128)
    const c = contrast;
    for (let i = 0; i < data.length; i += 4) {
      for (let ch = 0; ch < 3; ch++) {
        const v = data[i + ch];
        let nv = 128 + c * (v - 128);
        if (nv < 0) nv = 0;
        if (nv > 255) nv = 255;
        data[i + ch] = nv;
      }
      // leave alpha untouched
    }
    ctx.putImageData(id, 0, 0);
    const ct = new THREE.CanvasTexture(canvas);
    // preserve typical texture settings from source
    ct.flipY = srcTexture.flipY;
    if (srcTexture.wrapS) ct.wrapS = srcTexture.wrapS;
    if (srcTexture.wrapT) ct.wrapT = srcTexture.wrapT;
    // apply mirror fix if needed
    try {
      if (ct.center) ct.center.set(0.5, 0.5);
      // Ensure we do NOT flip textures horizontally here; preserve original orientation
      ct.repeat.x = Math.abs(ct.repeat.x || 1);
    } catch (e) {}
    ct.needsUpdate = true;
    return ct;
  } catch (e) {
    // if canvas operations fail, return original texture
    return srcTexture;
  }
}

// small HTML-escape helper used when injecting text into innerHTML
function escapeHtml(str) {
  if (!str && str !== 0) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const books = [
  { cover: 'images/book1-cover.jpg', pages: 10, title: 'David Frisch - Thank You', description: 'A kaleidoscopic perspective. 172 pages.', binding: 'A4 - Hardcover', price: '€20' },
  { cover: 'images/book2-cover.jpg', pages: 10, title: 'David Frisch - Impressions', description: 'Time keeps on slipping by. 126 pages.', binding: 'A4 - Hardcover', price: '€15' },
  { cover: 'images/book3-cover.jpg', pages: 10, title: 'David L. & Vinzenz K. - Appalachia Roadtrip', description: 'Documenting a road trip through rural Appalachia. 336 pages.', binding: 'A5 - Hardcover', price: '€15' }
];

const PAGE_WIDTH = 1.9; // width of a single page plane
// Mobile stack layout settings
const STACK_SPACING = 3.4; // vertical distance between stacked books on mobile
const MOBILE_CAMERA_Z = 12;   // camera z distance on mobile so the stack fits but books are larger on-screen
const FOLLOW_POS_ALPHA = 0.45; // lerp alpha for position when following camera
const FOLLOW_ROT_ALPHA = 0.45; // slerp alpha for rotation when following camera
// Fixed reading positions (higher view, looking slightly down)
const READING_BOOK_POS = new THREE.Vector3(0, 1, 0);
const READING_CAMERA_POS = new THREE.Vector3(0, 2.2, 3.6);
const READING_CAMERA_TARGET = new THREE.Vector3(0, 1, 0);

let scene, camera, renderer, controls;
let bookGroups = [], selected = null;
let openMode = false; // whether a book is currently opened for reading
let IS_MOBILE = false;
const mobilePointer = { down: false, startX: 0, startY: 0, startTime: 0, movedX: 0, movedY: 0 };
let mobileOverlayEl = null;
let mobileOverlayImg = null;
let mobileOverlayOpen = false;
let mobileBookIndex = 0;
let mobileCurrentPage = 0;
let focusedBookIndex = 0;

init();
animate();

function init() {
  const canvas = document.getElementById('three-canvas');
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 100);
  // start with a slightly higher vantage point looking down at the books
  camera.position.set(0, 3.2, 6);
  // detect simple mobile heuristics
  // runtime overrides: URL query param ?mobile=1 takes highest precedence, then localStorage.forceMobile, then the FORCE_MOBILE constant
  const query = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const qsForce = query && (query.get('mobile') === '1' || query.get('mobile') === 'true');
  const lsForce = (typeof localStorage !== 'undefined' && localStorage.getItem('forceMobile') === '1');
  const isMobile = qsForce || lsForce || FORCE_MOBILE || /Mobi|Android|iPhone|iPad|Phone/i.test(navigator.userAgent) || Math.min(window.innerWidth, window.innerHeight) < 600;
  IS_MOBILE = isMobile;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: !isMobile });
  // cap pixel ratio to avoid blowing up mobile GPU
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  // disable interactive camera controls on mobile for the floating stacked layout
  if (isMobile) controls.enabled = false;
  // Restrict vertical rotation: compute current polar and lock it so user cannot change vertical axis
  (function lockVertical() {
    const v = camera.position.clone().sub(controls.target || new THREE.Vector3());
    const r = v.length();
    const polar = Math.acos(THREE.MathUtils.clamp(v.y / r, -1, 1));
    controls.minPolarAngle = polar;
    controls.maxPolarAngle = polar;
    // allow wide horizontal movement
    controls.minAzimuthAngle = -Math.PI;
    controls.maxAzimuthAngle = Math.PI;
    // allow zoom/pan but keep distances sensible
    controls.enablePan = true;
    controls.minDistance = 2;
    controls.maxDistance = 12;
  })();
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dir = new THREE.DirectionalLight(0xffffff, 0.6);
  dir.position.set(5, 10, 5);
  scene.add(dir);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.MeshPhongMaterial({ color: 0x999999 })
  );
  floor.rotation.x = -Math.PI/2;
  scene.add(floor);
  // hide floor on mobile to create a floating, flat layout
  floor.visible = !isMobile;
  const loader = new THREE.TextureLoader();
  books.forEach((b, i) => {
    const g = new THREE.Group();
  const rawCover = loader.load(b.cover, undefined, undefined, () => {});
  // on mobile skip the canvas-based contrast preprocessing to avoid main-thread work
  const coverTex = isMobile ? rawCover : createContrastCanvasTexture(rawCover, GLOBAL_CONTRAST);
  if (coverTex && coverTex.repeat) coverTex.repeat.x = Math.abs(coverTex.repeat.x || 1);
  const mat = new THREE.MeshPhongMaterial({ map: coverTex });
  const front = new THREE.Mesh(new THREE.PlaneGeometry(2, 2.8), mat);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(2, 2.8), mat.clone());
  back.rotation.y = Math.PI;
  // give the book some thickness via a simple block behind the covers
  const thickness = 0.18;
  const blockGeom = new THREE.BoxGeometry(2, 2.8, thickness);
  // Create per-face materials: order is +X, -X, +Y, -Y, +Z, -Z
  const faceMaterials = [
    new THREE.MeshPhongMaterial({ color: 0xffffff }), // +X
    new THREE.MeshPhongMaterial({ color: 0x2b2b2b }), // -X  <-- left/back face dark grey
    new THREE.MeshPhongMaterial({ color: 0xffffff }), // +Y
    new THREE.MeshPhongMaterial({ color: 0xffffff }), // -Y
    new THREE.MeshPhongMaterial({ color: 0xffffff }), // +Z
    new THREE.MeshPhongMaterial({ color: 0xffffff })  // -Z
  ];
  const block = new THREE.Mesh(blockGeom, faceMaterials);
  block.position.z = 0; // block centered in book
  // position covers to sit slightly outside the block
  back.position.z = -thickness/2 - 0.01;
  // Create a pivot for the front cover so it rotates from the book spine (left edge)
  const coverHalfWidth = 1; // half of 2
  const frontPivot = new THREE.Object3D();
  frontPivot.position.set(-coverHalfWidth, 0, 0);
  // place front mesh so its left edge sits at the pivot
  front.position.set(coverHalfWidth, 0, thickness/2 + 0.01);
  frontPivot.add(front);
  g.add(frontPivot, block, back);
  g.userData = { front, back, frontPivot, block, pages: [], idx: 0, bookIndex: i };
    for (let p = 1; p <= b.pages; p++) {
      // load page texture with fallback if file missing
      let ptex = null;
      const path = `images/book${i+1}-p${p}.jpg`;
      try {
        ptex = loader.load(path, undefined, undefined, () => { /* onError */ });
        // apply contrast preprocessing unless on mobile
        if (ptex && !isMobile) ptex = createContrastCanvasTexture(ptex, GLOBAL_CONTRAST);
      } catch (err) {
        ptex = null;
      }
  if (ptex && ptex.repeat) ptex.repeat.x = Math.abs(ptex.repeat.x || 1);
  const material = ptex ? new THREE.MeshPhongMaterial({ map: ptex, side: THREE.DoubleSide }) : new THREE.MeshPhongMaterial({ color: 0xffffff, side: THREE.DoubleSide });
      const pm = new THREE.Mesh(new THREE.PlaneGeometry(PAGE_WIDTH, 2.7), material);
  pm.position.set(0, 0, 0.02 + 0.001 * p);
      pm.visible = false;
      g.add(pm);
      g.userData.pages.push(pm);
    }
    if (isMobile) {
      // floating vertical stack: center X/Z so it behaves like a flat website
      const spacing = STACK_SPACING;
      const startY = 1 + ((books.length - 1) * spacing) / 2;
      g.position.set(0, startY - i * spacing, 0);
  // reset any non-flat scaling and slightly enlarge books on mobile for better tap targets
  const MOBILE_BOOK_SCALE = 1.12;
  g.scale.set(MOBILE_BOOK_SCALE, MOBILE_BOOK_SCALE, MOBILE_BOOK_SCALE);
      // face camera and give a slight tilt so rotation reads as 3D
      g.rotation.y = 0;
      g.rotation.x = 0.02;
    // add an invisible hit plane in world space to make taps reliable (kept in scene root)
  const HITPLANE_DEBUG_VISIBLE = false; // set true to visualize hit planes when debugging on device
  // reduce vertical size to avoid overlap between stacked hit planes
  const hitW = PAGE_WIDTH * 2.6, hitH = PAGE_WIDTH * 1.9;
  const hitMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: HITPLANE_DEBUG_VISIBLE ? 0.35 : 0 });
  hitMat.depthTest = false;
  const hitPlane = new THREE.Mesh(new THREE.PlaneGeometry(hitW, hitH), hitMat);
  hitPlane.renderOrder = 9999;
  hitPlane.visible = HITPLANE_DEBUG_VISIBLE;
  // link back to the book group so clicks map reliably
  hitPlane.userData.bookGroup = g;
  hitPlane.userData.bookIndex = i;
  // ensure hit plane is double-sided so raycasts hit regardless of orientation
  hitPlane.material.side = THREE.DoubleSide;
  // add to scene root (we'll update its world position each frame)
  scene.add(hitPlane);
  g.userData.hitPlane = hitPlane;
  // store base y offset so planes avoid overlapping vertically when stacked
  g.userData._hitPlaneYOffset = (i - (books.length - 1) / 2) * 0.02; // tiny offset scaled by index
    } else {
      const ang = (i / books.length) * Math.PI * 2;
      g.position.set(Math.cos(ang) * 4, 1, Math.sin(ang) * 4);
      g.rotation.y = -ang + Math.PI/2;
    }
    scene.add(g);
    bookGroups.push(g);
  });
  window.addEventListener('resize', onResize);
  // ensure initial camera focuses the stack on mobile (so all books are visible)
  if (IS_MOBILE) {
    focusedBookIndex = 0;
    // center camera vertically on the stack center (we centered stack at y=1)
  // recompute stack center based on new spacing
  const stackCenterY = 1; // world center remains 1 for visual alignment
  camera.position.y = stackCenterY; // look at center of stacked books
    // pull camera back so entire stack fits comfortably
    camera.position.z = MOBILE_CAMERA_Z;
    if (controls && controls.target) controls.target.set(0, 1, 0);
  }
  // create the overlay DOM (used for mobile and desktop two-up viewer)
  mobileOverlayEl = document.createElement('div');
  mobileOverlayEl.id = 'mobile-overlay';
  Object.assign(mobileOverlayEl.style, {
    position: 'fixed', left: '0', top: '0', right: '0', bottom: '0',
    display: 'none', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(0,0,0,0.95)', zIndex: 20000,
    touchAction: 'none' // ensure we receive pointermove events and prevent browser panning
  });
  // pager UI: title and counter
  const overlayMeta = document.createElement('div');
  Object.assign(overlayMeta.style, { position: 'absolute', top: '12px', left: '12px', right: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#fff', fontFamily: 'sans-serif', zIndex: 21000 });
  const overlayTitle = document.createElement('div');
  overlayTitle.id = 'mobile-overlay-title';
  overlayTitle.style.fontSize = '16px';
  overlayTitle.className = 'overlay-title';
  const titleRow = document.createElement('div');
  titleRow.style.display = 'flex';
  titleRow.style.alignItems = 'center';
  titleRow.appendChild(overlayTitle);
  // close button top-right
  const overlayClose = document.createElement('button');
  overlayClose.textContent = '✕';
  Object.assign(overlayClose.style, { background: 'transparent', border: 'none', color: '#fff', fontSize: '20px', cursor: 'pointer' });
  overlayClose.addEventListener('click', (ev) => { ev.stopPropagation(); hideMobileOverlay(); });
  overlayMeta.appendChild(titleRow);
  overlayMeta.appendChild(overlayClose);
  // for desktop we'll show a two-up layout; create wrapper and two images
  const twoUpWrap = document.createElement('div');
  twoUpWrap.className = 'two-up-wrap';
  const leftImg = document.createElement('img');
  const rightImg = document.createElement('img');
  [leftImg, rightImg].forEach(img => Object.assign(img.style, { maxWidth: '100%', maxHeight: '78%', objectFit: 'contain', marginTop: '8px', touchAction: 'none', userSelect: 'none' }));
  twoUpWrap.appendChild(leftImg);
  twoUpWrap.appendChild(rightImg);
  // keep mobileOverlayImg reference for single-image mobile flow; store left/right for desktop
  mobileOverlayImg = leftImg;
  mobileOverlayEl.appendChild(overlayMeta);
  mobileOverlayEl.appendChild(twoUpWrap);
  mobileOverlayEl._leftImg = leftImg;
  mobileOverlayEl._rightImg = rightImg;
  // bottom-right counter
  const overlayCounter = document.createElement('div');
  overlayCounter.id = 'mobile-overlay-counter';
  overlayCounter.className = 'overlay-meta';
  Object.assign(overlayCounter.style, { position: 'absolute', right: '12px', bottom: '12px', color: '#fff', fontSize: '14px', fontFamily: 'sans-serif', zIndex: 21000 });
  mobileOverlayEl.appendChild(overlayCounter);
  // store references for updates
  mobileOverlayEl._titleEl = overlayTitle;
  mobileOverlayEl._counterEl = overlayCounter;
  // no header meta; pages/price will appear in the bottom-left info box using class 'overlay-meta'
    document.body.appendChild(mobileOverlayEl);
    // overlay pointer handlers
    let ovStartX = 0, ovStartY = 0, ovStartT = 0;
    mobileOverlayEl.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      ovStartX = ev.clientX; ovStartY = ev.clientY; ovStartT = performance.now();
      console.debug('[overlay] pointerdown', ovStartX, ovStartY);
      try { mobileOverlayEl.setPointerCapture && mobileOverlayEl.setPointerCapture(ev.pointerId); } catch (e) {}
    });
    mobileOverlayEl.addEventListener('pointermove', (ev) => {
      // keep tracking in case we want to animate or cancel
      // no heavy work here to avoid jank
    });
    mobileOverlayEl.addEventListener('pointerup', (ev) => {
      const dx = ev.clientX - ovStartX; const dy = ev.clientY - ovStartY; const dt = performance.now() - ovStartT;
      const ABSX = Math.abs(dx), ABSY = Math.abs(dy);
      const SW = 30;
      console.debug('[overlay] pointerup', dx, dy, dt);
      try { mobileOverlayEl.releasePointerCapture && mobileOverlayEl.releasePointerCapture(ev.pointerId); } catch (e) {}
      if (ABSX > ABSY && ABSX > SW) {
        // horizontal swipe inside overlay: pages
        if (dx < 0) mobileOverlayNext(); else mobileOverlayPrev();
      } else if (ABSY > ABSX && ABSY > SW) {
        // vertical swipe inside overlay: close viewer
        hideMobileOverlay();
      } else {
        // tap: advance to next page (don't immediately close)
        mobileOverlayNext();
      }
    });
    mobileOverlayEl.addEventListener('pointercancel', (ev) => {
      // treat cancel like a close to reset state
      try { mobileOverlayEl.releasePointerCapture && mobileOverlayEl.releasePointerCapture(ev.pointerId); } catch (e) {}
      console.debug('[overlay] pointercancel');
    });
  // use pointer events for better mobile/touch handling
  renderer.domElement.addEventListener('pointerdown', (ev) => {
    mobilePointer.down = true;
    mobilePointer.startX = ev.clientX;
    mobilePointer.startY = ev.clientY;
    mobilePointer.startTime = performance.now();
    mobilePointer.movedX = 0;
    mobilePointer.movedY = 0;
  });
  renderer.domElement.addEventListener('pointermove', (ev) => {
    if (!mobilePointer.down) return;
    mobilePointer.movedX = ev.clientX - mobilePointer.startX;
    mobilePointer.movedY = ev.clientY - mobilePointer.startY;
  });
  renderer.domElement.addEventListener('pointerup', (ev) => {
    if (!mobilePointer.down) return;
    mobilePointer.down = false;
    const dt = performance.now() - mobilePointer.startTime;
    const dx = ev.clientX - mobilePointer.startX;
    const dy = ev.clientY - mobilePointer.startY;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    const TAP_THRESHOLD = 8; // pixels
    const SWIPE_THRESHOLD = 30; // pixels
    // if tap (short distance and short time), treat as tap -> open or navigate
    if (absX < TAP_THRESHOLD && absY < TAP_THRESHOLD && dt < 400) {
      const fake = { clientX: ev.clientX, clientY: ev.clientY };
      // if tapped a book in stacked mobile view, open single-page reader
  // if overlay is open, let overlay handle taps
  if (!mobileOverlayOpen) onClick(fake);
      return;
    }
    // if a book is open, vertical swipes inside overlay handled there; here, if openMode but overlay not open do nothing
    if (openMode && mobileOverlayOpen) {
      // overlay handles navigation
      return;
    }
    // if no book open: vertical swipe scrolls between stacked books (change focusedBookIndex and animate camera Y)
    if (!openMode && Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > SWIPE_THRESHOLD) {
      const spacing = STACK_SPACING;
      if (dy < 0) {
        // swipe up -> move to next book (index +1)
        focusedBookIndex = Math.min(focusedBookIndex + 1, bookGroups.length - 1);
      } else {
        // swipe down -> prev
        focusedBookIndex = Math.max(focusedBookIndex - 1, 0);
      }
        // compute the focused book world position and animate camera to center on it
        const targetBook = bookGroups[focusedBookIndex];
        if (targetBook) {
          const targetWorldPos = targetBook.position.clone();
          // pull camera back along Z so the stack still fits
    const camTarget = { x: targetWorldPos.x, y: targetWorldPos.y, z: MOBILE_CAMERA_Z };
    new Tween(camera.position).to({ x: camTarget.x, y: camTarget.y, z: camTarget.z }, 400).start();
          if (controls && controls.target) new Tween(controls.target).to({ x: targetWorldPos.x, y: targetWorldPos.y, z: 0 }, 400).start();
        }
      return;
    }
  });
  // wire inquire/buy UI
  const buyBtn = document.getElementById('buy-button');
  const selectModal = document.getElementById('select-modal');
  const selectForm = document.getElementById('select-form');
  const selectSend = document.getElementById('select-send');
  const selectClose = selectModal ? selectModal.querySelector('.close') : null;
  const previewModal = document.getElementById('modal');
  const previewClose = previewModal ? previewModal.querySelector('.close[data-close="preview"]') : null;
  if (buyBtn) buyBtn.addEventListener('click', () => {
    // populate form
    if (!selectForm || !selectModal) return;
    selectForm.innerHTML = '';
    bookGroups.forEach((g, i) => {
      const label = document.createElement('label');
  const cb = document.createElement('input'); cb.type = 'checkbox'; cb.name = 'book'; cb.value = i;
  label.appendChild(cb);
  const titleText = (books[i] && books[i].title) ? books[i].title : `Book ${i+1}`;
  label.appendChild(document.createTextNode(' ' + titleText));
  selectForm.appendChild(label);
    });
    selectModal.classList.remove('hidden');
  });
  if (selectClose) selectClose.addEventListener('click', () => selectModal.classList.add('hidden'));
  // wire preview modal close button / backdrop
  if (previewClose) previewClose.addEventListener('click', () => {
    if (previewModal) previewModal.classList.add('hidden');
    // if we were in an open reading state, close the book preview
    if (openMode && selected) {
      closeBook(selected);
    }
  });
  if (previewModal) previewModal.addEventListener('click', (ev) => {
    if (ev.target === previewModal) {
      previewModal.classList.add('hidden');
      if (openMode && selected) closeBook(selected);
    }
  });
  // clicking on the backdrop should close the modal
  if (selectModal) selectModal.addEventListener('click', (ev) => {
    if (ev.target === selectModal) selectModal.classList.add('hidden');
  });
  if (selectSend) selectSend.addEventListener('click', (ev) => {
    ev.preventDefault();
    const checked = Array.from(selectForm.elements['book'] || []).filter(n => n.checked).map(n => parseInt(n.value,10));
    if (!checked.length) {
      alert('Select at least one book to inquire about.');
      return;
    }
    // compose mailto using book titles when available
    const subject = encodeURIComponent('Inquiry about books');
    const titles = checked.map(i => (books[i] && books[i].title) ? books[i].title : `Book ${i+1}`);
    // use real newlines in the message body and then URI-encode once
    const bodyText = 'I am interested in the following books:\n' + titles.join('\n');
    const body = encodeURIComponent(bodyText);
    window.location.href = `mailto:distortbooking+books@gmail.com?subject=${subject}&body=${body}`;
    selectModal.classList.add('hidden');
  });
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}


function openBook(g) {
  g.userData.idx = 0;
  // mobile: open a simple in-place single-page reader without moving camera
  if (IS_MOBILE) {
  selected = g;
  // show full-screen mobile overlay starting at page 0
  mobileBookIndex = bookGroups.indexOf(g);
  mobileCurrentPage = 0;
  showMobileOverlay(mobileBookIndex, mobileCurrentPage);
  openMode = true;
  return;
  }
  controls.enabled = false;
  // save original transforms so we can restore on close
  g.userData._orig = {
    position: g.position.clone(),
    rotation: g.rotation.clone(),
    quaternion: g.quaternion.clone()
  };
  // save camera original state
  window._origCamera = {
    position: camera.position.clone(),
    quaternion: camera.quaternion.clone(),
    target: controls.target ? controls.target.clone() : null
  };
  // move book to fixed reading spot and move camera to reading pose
  const moveTween = new Tween(g.position).to({ x: READING_BOOK_POS.x, y: READING_BOOK_POS.y, z: READING_BOOK_POS.z }, 600).start();
  // compute target quaternion so the book front faces the reading camera (use the fixed reading pose)
  const bookTmp = g.clone();
  bookTmp.position.copy(READING_BOOK_POS);
  // compute the reading-camera position in world space and use that as lookAt target
  const readCamWorld = READING_CAMERA_POS.clone();
  bookTmp.lookAt(readCamWorld);
  // the book plane's front may face -Z; adjust by rotating 180deg if needed
  const bookTargetQuat = bookTmp.quaternion.clone();
  // flip 180deg around Y so the front of the book faces the camera correctly
  const q180 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), Math.PI);
  bookTargetQuat.multiply(q180);
  console.log('[openBook] book current quat', g.quaternion.toArray());
  console.log('[openBook] book target quat', bookTargetQuat.toArray());
  // apply tween to book quaternion
  const bookRot = new Tween(g.quaternion).to({ x: bookTargetQuat.x, y: bookTargetQuat.y, z: bookTargetQuat.z, w: bookTargetQuat.w }, 600).start();
  // set controls target so camera looks at book center
  if (controls && controls.target) controls.target.copy(READING_BOOK_POS);
  // compute target camera quaternion to look at the reading book position
  const tmpCam = camera.clone();
  tmpCam.position.copy(READING_CAMERA_POS);
  tmpCam.lookAt(READING_CAMERA_TARGET);
  const targetCamQuat = tmpCam.quaternion;
  const camMove = new Tween(camera.position).to({ x: READING_CAMERA_POS.x, y: READING_CAMERA_POS.y, z: READING_CAMERA_POS.z }, 600).start();
  const camRot = new Tween(camera.quaternion).to({ x: targetCamQuat.x, y: targetCamQuat.y, z: targetCamQuat.z, w: targetCamQuat.w }, 600).start();
  // animate front cover opening
  const pivot = g.userData.frontPivot;
  if (pivot) {
    new Tween(pivot.rotation).to({ y: -Math.PI/2 }, 600).start();
  }
  // Show pages after the camera motion completes
  camRot.onComplete(() => {
    console.log('[openBook] camera move complete, showing pages');
    // ensure selected overlays others
    makeOverlay(g, true);
    showPages(g);
    // hide both covers so pages are fully visible
    if (g.userData.front) g.userData.front.visible = false;
    if (g.userData.back) g.userData.back.visible = false;
    // hide the solid block so pages fill the viewport cleanly
    if (g.userData.block) g.userData.block.visible = false;
    // if frontPivot has children, hide them too (covers may be child meshes)
    if (g.userData.frontPivot && g.userData.frontPivot.children) {
      g.userData.frontPivot.children.forEach(ch => ch.visible = false);
    }
    openMode = true;
  });
  // Fallback: ensure pages become visible after animation duration
  setTimeout(() => {
    if (!openMode) {
  console.log('[openBook] fallback timeout, showing pages');
  makeOverlay(g, true);
  showPages(g);
  if (g.userData.front) g.userData.front.visible = false;
  if (g.userData.back) g.userData.back.visible = false;
    if (g.userData.frontPivot && g.userData.frontPivot.children) {
      g.userData.frontPivot.children.forEach(ch => ch.visible = false);
    }
  openMode = true;
    }
  }, 650);
}

function showMobileOverlay(bookIdx, pageIdx) {
  if (!mobileOverlayEl) return;
  mobileOverlayOpen = true;
  mobileOverlayEl.style.display = 'flex';
  mobileBookIndex = bookIdx;
  mobileCurrentPage = pageIdx;
  const path = `images/book${bookIdx+1}-p${pageIdx+1}.jpg`;
  mobileOverlayImg.src = path;
  // update title & counter
  if (mobileOverlayEl._titleEl) mobileOverlayEl._titleEl.textContent = books[bookIdx] && books[bookIdx].title ? books[bookIdx].title : `Book ${bookIdx+1}`;
  if (mobileOverlayEl._counterEl) mobileOverlayEl._counterEl.textContent = `${pageIdx+1}/${books[bookIdx].pages}`;
  // bottom-left info: description, binding, pagecount, price
  let info = mobileOverlayEl.querySelector('#mobile-overlay-info');
  if (!info) {
    info = document.createElement('div');
    info.id = 'mobile-overlay-info';
    Object.assign(info.style, {
      position: 'absolute',
      left: '12px',
      bottom: '12px',
      maxWidth: '55%',
      color: '#fff',
      background: 'rgba(0,0,0,0.5)',
      padding: '10px',
      borderRadius: '6px',
      fontFamily: 'sans-serif',
      fontSize: '13px',
      lineHeight: '1.2',
      zIndex: 21001
    });
    mobileOverlayEl.appendChild(info);
  }
  const b = books[bookIdx] || {};
  // populate text safely using textContent pieces
  info.innerHTML = '';
  // do not repeat the title here; only show description and metadata
  const descRow = document.createElement('div'); descRow.style.marginBottom = '6px'; descRow.textContent = b.description || '';
  const metaRow = document.createElement('div');
  metaRow.className = 'overlay-meta';
  metaRow.style.fontSize = '12px';
  metaRow.textContent = `Pages: ${b.pages || ''} · Price: ${b.price || ''}`;
  info.appendChild(descRow);
  info.appendChild(metaRow);
  // disable three.js interactions
  if (controls) controls.enabled = false;
}

function hideMobileOverlay() {
  if (!mobileOverlayEl) return;
  mobileOverlayOpen = false;
  mobileOverlayEl.style.display = 'none';
  // remove bottom-left info panel if present
  const info = mobileOverlayEl.querySelector('#mobile-overlay-info');
  if (info && info.parentNode) info.parentNode.removeChild(info);
  // re-enable three.js interactions
  if (controls) controls.enabled = true;
  // reset open mode and selection
  openMode = false;
  selected = null;
}

function mobileOverlayNext() {
  const b = books[mobileBookIndex];
  if (!b) return;
  if (mobileCurrentPage < b.pages - 1) {
    mobileCurrentPage++;
  mobileOverlayImg.src = `images/book${mobileBookIndex+1}-p${mobileCurrentPage+1}.jpg`;
  if (mobileOverlayEl && mobileOverlayEl._counterEl) mobileOverlayEl._counterEl.textContent = `${mobileCurrentPage+1}/${b.pages}`;
  } else {
    // finished previews: close overlay
    hideMobileOverlay();
  }
}

function mobileOverlayPrev() {
  if (mobileCurrentPage > 0) {
    mobileCurrentPage--;
  mobileOverlayImg.src = `images/book${mobileBookIndex+1}-p${mobileCurrentPage+1}.jpg`;
  if (mobileOverlayEl && mobileOverlayEl._counterEl) mobileOverlayEl._counterEl.textContent = `${mobileCurrentPage+1}/${books[mobileBookIndex].pages}`;
  } else {
    // at first page: close overlay
    hideMobileOverlay();
  }
}

function closeBook(g) {
  // hide pages immediately
  g.userData.pages.forEach(pg => pg.visible = false);
  openMode = false;
  // mobile: simple restore of visible parts and overlay, no camera or transform tweens
  if (IS_MOBILE) {
  makeOverlay(g, false);
    if (g.userData.front) g.userData.front.visible = true;
    if (g.userData.back) g.userData.back.visible = true;
    if (g.userData.frontPivot && g.userData.frontPivot.children) {
      g.userData.frontPivot.children.forEach(ch => ch.visible = true);
    }
    if (g.userData.block) g.userData.block.visible = true;
    controls.enabled = true;
  // hide overlay if open
  if (mobileOverlayOpen) hideMobileOverlay();
    return;
  }
  controls.enabled = true;
  const orig = g.userData._orig;
  // restore original transforms if we have them
  if (orig) {
    new Tween(g.position).to({ x: orig.position.x, y: orig.position.y, z: orig.position.z }, 600).start();
    const qTween = new Tween(g.quaternion).to({ x: orig.quaternion.x, y: orig.quaternion.y, z: orig.quaternion.z, w: orig.quaternion.w }, 600).start();
    qTween.onComplete(() => { delete g.userData._orig; });
  } else {
    const i = bookGroups.indexOf(g);
    const ang = (i / books.length) * Math.PI * 2;
    new Tween(g.position)
      .to({x:Math.cos(ang)*4,y:1,z:Math.sin(ang)*4},600).start();
    new Tween(g.rotation)
      .to({x:0,y:-ang+Math.PI/2,z:0},600).start();
  }
  // animate front cover closed
  const pivot = g.userData.frontPivot;
  if (pivot) {
    new Tween(pivot.rotation).to({ y: 0 }, 400).start();
  }
  // remove overlay behavior
  makeOverlay(g, false);
  // restore front cover visibility
  if (g.userData.front) g.userData.front.visible = true;
  // restore back cover visibility
  if (g.userData.back) g.userData.back.visible = true;
  // restore any pivot child visibility
  if (g.userData.frontPivot && g.userData.frontPivot.children) {
    g.userData.frontPivot.children.forEach(ch => ch.visible = true);
  }
  // restore block visibility
  if (g.userData.block) g.userData.block.visible = true;
  // restore camera if we saved original
  if (window._origCamera) {
    const oc = window._origCamera;
    new Tween(camera.position).to({ x: oc.position.x, y: oc.position.y, z: oc.position.z }, 600).start();
    const qTween = new Tween(camera.quaternion).to({ x: oc.quaternion.x, y: oc.quaternion.y, z: oc.quaternion.z, w: oc.quaternion.w }, 600).start();
    qTween.onComplete(() => {
      if (controls && controls.target && oc.target) controls.target.copy(oc.target);
      delete window._origCamera;
    });
  }
}

function makeOverlay(g, on) {
  // ensure selected book renders above others by disabling depthTest and increasing renderOrder
  const setMesh = (m, order) => {
    if (!m) return;
    if (m.material) {
      // Keep front cover depthTest enabled so it properly occludes pages when closed.
      // We'll only disable depthTest for pages and back so the opened book overlays background.
      const isFront = (g.userData.frontPivot && g.userData.frontPivot.children[0] === m);
      if (isFront) {
        m.material.depthTest = true;
        m.renderOrder = on ? 1001 : 0;
      } else {
        m.material.depthTest = on ? false : true;
        m.renderOrder = on ? order : 0;
      }
      m.material.needsUpdate = true;
    }
  };
  // front cover pivot contains front mesh
  if (g.userData.frontPivot && g.userData.frontPivot.children[0]) setMesh(g.userData.frontPivot.children[0], 1000);
  setMesh(g.userData.back, 999);
  (g.userData.pages || []).forEach((p, i) => setMesh(p, 1000 + i));

  // Desktop: instead of showing a modal/backdrop, show an inline info strip centered below the viewport
  try {
    // only show inline info on non-mobile (desktop) viewing mode
    if (IS_MOBILE) return;
    const infoWrap = document.getElementById('book-info-overlay');
    const infoContent = document.getElementById('book-info-content');
    if (!infoWrap || !infoContent) return;
    if (on) {
      const bidx = (typeof g.userData.bookIndex === 'number') ? g.userData.bookIndex : bookGroups.indexOf(g);
      const bi = books[bidx] || {};
      console.debug('[makeOverlay] SHOW info for book', bidx, bi.title);
      infoContent.innerHTML = `<strong>${escapeHtml(bi.title || '')}</strong> &nbsp; <span>${escapeHtml(bi.binding || '')}</span> &nbsp; <span>${escapeHtml(bi.pages ? bi.pages + ' pages' : '')}</span> &nbsp; <span>${escapeHtml(bi.price || '')}</span><div style="margin-top:6px">${escapeHtml(bi.description || '')}</div>`;
  // overlay is sticky to bottom via CSS; no dynamic top positioning needed
      infoWrap.classList.remove('hidden');
    } else {
      console.debug('[makeOverlay] HIDE info');
      infoWrap.classList.add('hidden');
      infoContent.innerHTML = '';
    }
  } catch (e) {
    // ignore if DOM elements are missing
  }
}

function flipNext(g) {
  // flipping disabled: no-op
  return;
}

function flipPrev(g) {
  // flipping disabled: no-op
  return;
}

// Animate a single page flip by pivoting the page around its inner edge
function flipPageAnimation(g, pageMesh, dir = 'forward', cb) {
  // create a pivot at the spine edge for this page
  const half = PAGE_WIDTH / 2;
  const isLeft = pageMesh.getWorldPosition(new THREE.Vector3()).x < g.getWorldPosition(new THREE.Vector3()).x;
  // compute world position for pivot at page inner edge
  const worldPivot = new THREE.Vector3();
  // page inner edge world position (page center +/- half)
  const pageWorldPos = pageMesh.getWorldPosition(new THREE.Vector3());
  const pageWorldQuat = pageMesh.getWorldQuaternion(new THREE.Quaternion());
  const localEdge = new THREE.Vector3(isLeft ? half : -half, 0, 0);
  localEdge.applyQuaternion(pageWorldQuat);
  worldPivot.copy(pageWorldPos).add(localEdge);
  // create pivot and attach at scene root, position it at world pivot
  const pivot = new THREE.Object3D();
  scene.add(pivot);
  pivot.position.copy(worldPivot);
  // convert pageMesh into pivot's local space: compute page's world matrix, then reparent
  const parent = pageMesh.parent;
  // compute page's world transform relative to pivot
  const tmpPos = pageWorldPos.clone();
  const tmpQuat = pageWorldQuat.clone();
  // remove page from parent and attach to pivot
  parent.remove(pageMesh);
  pivot.add(pageMesh);
  pageMesh.position.copy(tmpPos.sub(pivot.getWorldPosition(new THREE.Vector3())));
  pageMesh.quaternion.copy(tmpQuat);
  // choose rotation direction so right pages flip over left pages like a real book
  const start = { y: 0 };
  let endY = 0;
  if (!isLeft) {
    // right page: forward flip should rotate toward negative Y (over the left)
    endY = dir === 'forward' ? -Math.PI : 0;
  } else {
    // left page: backward flip should rotate toward positive Y (under/return)
    endY = dir === 'backward' ? Math.PI : 0;
  }
  const end = { y: endY };
  new Tween(start).to(end, 600).easing(Easing.Quadratic.InOut).onUpdate(() => {
    pivot.rotation.y = start.y;
  }).onComplete(() => {
    // restore hierarchy: remove pivot and re-add page to parent
    pivot.remove(pageMesh);
    parent.add(pageMesh);
    // restore page to expected local positions
    pageMesh.position.x = isLeft ? -PAGE_WIDTH/2 : PAGE_WIDTH/2;
    pageMesh.rotation.y = 0;
    scene.remove(pivot);
    if (cb) cb();
  }).start();
}
// Utility: show first two pages for a book group
function showPages(g) {
  const pages = g.userData.pages || [];
  pages.forEach(p => p.visible = false);
  // show current spread (use stored index if present)
  const left = (typeof g.userData._currentLeft === 'number') ? g.userData._currentLeft : 0;
  setSpread(pages, left);
  g.userData.idx = left;
  // ensure page materials render both sides
  pages.forEach(p => { if (p.material) p.material.side = THREE.DoubleSide; });

  // If we're in reading/open mode, enlarge and flatten the visible pages to fill viewport
  if (openMode) {
    const targetScale = 1.6; // desktop two-page scale
    const targetZ = 0.5; // bring pages closer to camera
    const flatRot = { x: 0, y: 0, z: 0 };
    if (IS_MOBILE) {
      // single-page centered reader on mobile
      const idx = left; // treat left as current page index
      const mesh = pages[idx];
      pages.forEach(p => { if (p !== mesh) p.visible = false; });
      if (mesh) {
        mesh.visible = true;
        mesh.rotation.y = 0;
        mesh.position.set(0, 0.1, targetZ);
        new Tween(mesh.scale).to({ x: 1.8, y: 1.8, z: 1 }, 300).start();
      }
    } else {
      const leftMesh = pages[left];
      const rightMesh = pages[left+1];
      if (leftMesh && leftMesh.visible) {
        new Tween(leftMesh.scale).to({ x: targetScale, y: targetScale, z: 1 }, 400).start();
        new Tween(leftMesh.position).to({ x: -PAGE_WIDTH * targetScale / 2, y: 0.1, z: targetZ }, 400).start();
        new Tween(leftMesh.rotation).to(flatRot, 400).start();
      }
      if (rightMesh && rightMesh.visible) {
        new Tween(rightMesh.scale).to({ x: targetScale, y: targetScale, z: 1 }, 400).start();
        new Tween(rightMesh.position).to({ x: PAGE_WIDTH * targetScale / 2, y: 0.1, z: targetZ }, 400).start();
        new Tween(rightMesh.rotation).to(flatRot, 400).start();
      }
    }
  } else {
    // ensure pages have default scale/position when not open
    pages.forEach(p => {
      p.scale.set(1,1,1);
    });
  }
  console.log('[showPages] showing pages', left, left + 1);
}

function setSpread(arr, leftIndex) {
  // leftIndex is the page index for mobile or left page index for desktop spreads
  arr.forEach(p => p.visible = false);
  if (IS_MOBILE) {
    // clamp
    if (leftIndex < 0) leftIndex = 0;
    if (leftIndex >= arr.length) leftIndex = arr.length - 1;
    const p = arr[leftIndex];
    if (p) {
      p.visible = true;
      p.position.set(0, 0, openMode ? 0.4 : 0.06);
      p.rotation.y = 0;
      p.renderOrder = 1000;
    }
    return;
  }
  // desktop: ensure even leftIndex (pair starts at even index)
  if (leftIndex % 2 === 1) leftIndex--;
  if (leftIndex < 0) leftIndex = 0;
  const rightIndex = leftIndex + 1;
  // compute positions so pages touch exactly at center
  const half = PAGE_WIDTH / 2;
  const leftX = -half;
  const rightX = half;
  if (arr[leftIndex]) {
    arr[leftIndex].visible = true;
    arr[leftIndex].position.x = leftX;
    arr[leftIndex].rotation.y = openMode ? 0 : 0.002; // nearly flat when open
    arr[leftIndex].position.z = openMode ? 0.4 : 0.06; // pull forward when open
    arr[leftIndex].renderOrder = 1;
  }
  if (arr[rightIndex]) {
    arr[rightIndex].visible = true;
    arr[rightIndex].position.x = rightX;
    arr[rightIndex].rotation.y = openMode ? 0 : -0.002;
    arr[rightIndex].position.z = openMode ? 0.4 : 0.06;
    arr[rightIndex].renderOrder = 2;
  }
}

function onClick(e) {
  const mouse = new THREE.Vector2(
    (e.clientX / window.innerWidth)*2 - 1,
    -(e.clientY / window.innerHeight)*2 + 1
  );
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(scene.children, true);
  // determine if the click hit a book group
  let clickedBook = null;
  if (intersects.length) {
    // iterate all intersects and prefer ones that map to a bookGroup (hitPlane or descendant)
    for (let k = 0; k < intersects.length; k++) {
      const obj = intersects[k].object;
      if (!obj) continue;
      if (obj.userData && obj.userData.bookGroup) {
        clickedBook = obj.userData.bookGroup;
        console.debug('[onClick] hitPlane mapped to book index', obj.userData.bookIndex);
        break;
      }
      let walk = obj;
      while (walk && !bookGroups.includes(walk)) walk = walk.parent;
      if (walk && bookGroups.includes(walk)) {
        clickedBook = walk;
        console.debug('[onClick] raycast hit descendant of book group', bookGroups.indexOf(walk));
        break;
      }
    }
  }

  if (clickedBook) {
    // clicked on a book
    if (selected && selected !== clickedBook) closeBook(selected);
    // mobile: if this book is already selected and open, tap closes it
    if (IS_MOBILE && selected === clickedBook && openMode) {
      closeBook(selected);
      selected = null;
      return;
    }
    // desktop: if this book is already selected and open, use left/right half-screen clicks to navigate spreads
    if (!IS_MOBILE && selected === clickedBook && openMode) {
      const cx = e.clientX;
      const pages = selected.userData.pages || [];
      const leftIndex = selected.userData.idx || 0;
      const next = Math.min(leftIndex + 2, pages.length - (pages.length % 2 === 0 ? 2 : 1));
      const prev = Math.max(leftIndex - 2, 0);
      if (cx < window.innerWidth / 2) {
        setSpread(pages, prev);
        selected.userData.idx = prev;
        selected.userData._currentLeft = prev;
      } else {
        setSpread(pages, next);
        selected.userData.idx = next;
        selected.userData._currentLeft = next;
      }
      return;
    }
    // otherwise open it
    selected = clickedBook;
    openBook(clickedBook);
    return;
  }

  // clicked anywhere that is not a book -> treat as outside click
  if (selected && openMode) {
    // check if the click hit one of the visible page meshes of the selected book
    const intersectsSelected = raycaster.intersectObjects(selected.children, true);
    if (intersectsSelected.length) {
      const hit = intersectsSelected[0].object;
      const pages = selected.userData.pages || [];
      const leftIndex = selected.userData.idx || 0;
      const rightIndex = leftIndex + 1;
      // if hit right page -> advance
      if (pages[rightIndex] && (hit === pages[rightIndex] || pages[rightIndex].children.includes(hit))) {
        const next = Math.min(leftIndex + 2, pages.length - (pages.length % 2 === 0 ? 2 : 1));
        setSpread(pages, next);
        selected.userData.idx = next;
        selected.userData._currentLeft = next;
        return;
      }
      // if hit left page -> rewind
      if (pages[leftIndex] && (hit === pages[leftIndex] || pages[leftIndex].children.includes(hit))) {
        const prev = Math.max(leftIndex - 2, 0);
        setSpread(pages, prev);
        selected.userData.idx = prev;
        selected.userData._currentLeft = prev;
        return;
      }
    }
    // otherwise close the book
  closeBook(selected);
  selected = null;
  openMode = false;
    return;
  }
}

function animate(time) {
  requestAnimationFrame(animate);
  TWEENUpdate(time);
  controls.update();
  // if mobile and stacked layout, apply small oscillation rotation to books
  if (IS_MOBILE) {
    const t = performance.now() * 0.0006;
    bookGroups.forEach((g, i) => {
      // slow continuous rotation so the books read as 3D objects
      const base = i * 0.15;
      g.rotation.y = base + t;
    });
  }
  // update mobile hit planes to match book front positions so raycasts hit reliably
  if (IS_MOBILE) {
    bookGroups.forEach((g) => {
      const hp = g.userData.hitPlane;
      if (!hp) return;
      // compute world position for a point at the book front (local z = depth/2 + small)
      const depth = (g.userData.block && g.userData.block.geometry && g.userData.block.geometry.parameters && g.userData.block.geometry.parameters.depth) ? g.userData.block.geometry.parameters.depth : 0.18;
      const local = new THREE.Vector3(0, 0, depth / 2 + 0.02);
      const worldPos = local.applyMatrix4(g.matrixWorld);
  // nudge the plane noticeably toward the camera so it sits in front of any cover geometry
  const toCam = camera.position.clone().sub(worldPos).normalize();
  const nudge = toCam.multiplyScalar(0.22); // slightly reduced nudge to avoid large protrusions
  // apply a tiny per-book Y offset so hit planes don't perfectly overlap when stacked
  const yOffset = g.userData._hitPlaneYOffset || 0;
  const adjustedPos = worldPos.clone().add(new THREE.Vector3(0, yOffset, 0)).add(nudge);
  hp.position.copy(adjustedPos);
  // align plane to face the camera exactly
  hp.quaternion.copy(camera.quaternion);
  // ensure plane larger for easier hits
  hp.scale.set(1.25, 1.15, 1.15);
    });
  }
  renderer.render(scene, camera);
}
