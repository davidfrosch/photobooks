// ============ 3D Book Shop - Three.js Implementation ============

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const books = [
  { id: 1, title: 'David Frisch - Thank You',
    description: 'A caleidoscopic perspective.',
    cover: 'images/book1-cover.jpg',
    pages: Array.from({length: 10}, (_, i) => `images/book1-p${i + 1}.jpg`),
    pageCount: 172,
    binding: 'A4 - Hardcover',
    price: '€20.00',
    bgColor: 'rgb(255 10 1)',
    color: 0xff0a01
  },
  { id: 2,
    title: 'David Frisch - Impressions',
    description: 'Time keeps slipping by',
    cover: 'images/book2-cover.jpg',
    pages: Array.from({length: 10}, (_, i) => `images/book2-p${i + 1}.jpg`),
    pageCount: 126,
    binding: 'A4 - Hardcover',
    price: '€20.00',
    bgColor: 'rgb(14 19 20 / 98%)',
    color: 0x0e1314
  },
  { id: 3,
    title: 'David L. and Vinzenz K. - Appalachia Roadtrip',
    description: 'A roadtrip through rural Appalachia, 2024',
    cover: 'images/book3-cover.jpg',
    pages: Array.from({length: 10}, (_, i) => `images/book3-p${i + 1}.jpg`),
    pageCount: 336,
    binding: 'A5 - Harcover',
    price: '€20.00',
    bgColor: 'rgb(0 1 1 / 98%)',
    color: 0x000101
  }
];

// small helpers for safe HTML insertion and truncation
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function shorten(s, n) {
  if (!s) return '';
  if (s.length <= n) return s;
  return s.slice(0, n-1) + '…';
}

// ============ Three.js Scene Setup ============
let scene, camera, renderer, controls;
let bookMeshes = [];
let selectedBook = null;
let isPageFlipping = false;
let animationId;

// Raycaster for mouse interaction
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function init3DScene() {
  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf0f0f0);
  scene.fog = new THREE.Fog(0xf0f0f0, 10, 50); // PS2-style distance fog

  // Camera
  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 5, 10);

  // Renderer with pixelated look
  const canvas = document.getElementById('three-canvas');
  renderer = new THREE.WebGLRenderer({ 
    canvas: canvas, 
    antialias: false // Disable antialiasing for pixelated look
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // Limit pixel ratio for retro feel
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.BasicShadowMap; // Use basic shadows for PS2 look

  // Controls
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.maxDistance = 20;
  controls.minDistance = 3;

  // Lighting - Simple PS2-style lighting
  const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(10, 10, 5);
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.width = 512;  // Low res shadows for retro feel
  directionalLight.shadow.mapSize.height = 512;
  directionalLight.shadow.camera.near = 0.5;
  directionalLight.shadow.camera.far = 50;
  directionalLight.shadow.camera.left = -10;
  directionalLight.shadow.camera.right = 10;
  directionalLight.shadow.camera.top = 10;
  directionalLight.shadow.camera.bottom = -10;
  scene.add(directionalLight);

  // Ground plane
  const groundGeometry = new THREE.PlaneGeometry(30, 30);
  const groundMaterial = new THREE.MeshLambertMaterial({ color: 0xcccccc });
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Create books
  create3DBooks();

  // Event listeners
  window.addEventListener('resize', onWindowResize);
  renderer.domElement.addEventListener('click', onBookClick);
  renderer.domElement.addEventListener('mousemove', onMouseMove);

  // Close book when clicking outside (use event coords for accurate hit testing)
  renderer.domElement.addEventListener('pointerdown', (e) => {
    if (!selectedBook) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    const tempMouse = new THREE.Vector2(x, y);
    raycaster.setFromCamera(tempMouse, camera);
    // Intersect only against the currently selected book's children to be precise
    const intersects = raycaster.intersectObjects(selectedBook.children, true);
    if (!intersects.length) {
      closeBook3D(selectedBook);
    }
  });

  // Start render loop
  animate();
}

// ============ 3D Book Creation ============
function create3DBooks() {
  const loader = new THREE.TextureLoader();
  
  books.forEach((bookData, index) => {
    // Create book group
    const bookGroup = new THREE.Group();
    bookGroup.userData = { bookData, index, pages: [], currentPage: 0, isAnimating: false };

    // Load cover texture
    loader.load(bookData.cover, (coverTexture) => {
      coverTexture.generateMipmaps = false;
      coverTexture.minFilter = THREE.NearestFilter;
      coverTexture.magFilter = THREE.NearestFilter;

  // Book cover as two thin planes (front and back) to avoid a bulky box
  const coverMaterialFront = new THREE.MeshLambertMaterial({ 
    map: coverTexture,
    color: 0xffffff,
    side: THREE.FrontSide
  });
  const coverMaterialBack = new THREE.MeshLambertMaterial({ 
    map: coverTexture,
    color: 0xffffff,
    side: THREE.FrontSide
  });

  const frontGeometry = new THREE.PlaneGeometry(2, 2.8);
  const backGeometry = new THREE.PlaneGeometry(2, 2.8);

  const frontMesh = new THREE.Mesh(frontGeometry, coverMaterialFront);
  const backMesh = new THREE.Mesh(backGeometry, coverMaterialBack);

  // Position front and back slightly apart to simulate thin cover
  const coverHalfThickness = 0.04; // slimmer cover
  frontMesh.position.z = coverHalfThickness;
  backMesh.position.z = -coverHalfThickness;
  // Flip back mesh so texture faces outward
  backMesh.rotateY(Math.PI);

  frontMesh.castShadow = true;
  backMesh.receiveShadow = true;
  bookGroup.add(frontMesh);
  bookGroup.add(backMesh);
  // store cover meshes for later repositioning when opening the book
  bookGroup.userData.frontMesh = frontMesh;
  bookGroup.userData.backMesh = backMesh;
  // store original local transform for covers so we can restore them on close
  bookGroup.userData.frontMeshOriginal = { pos: frontMesh.position.clone(), rot: frontMesh.rotation.clone() };
  bookGroup.userData.backMeshOriginal = { pos: backMesh.position.clone(), rot: backMesh.rotation.clone() };

  // Add a back cover texture if available (fallback to front cover)
  if (bookData.backCover) {
    loader.load(bookData.backCover, (backTex) => {
      backTex.generateMipmaps = false;
      backTex.minFilter = THREE.NearestFilter;
      backTex.magFilter = THREE.NearestFilter;
      backMesh.material.map = backTex;
      backMesh.material.needsUpdate = true;
    });
  } else {
    // reuse coverTexture (already applied) - backMesh already uses front texture flipped
  }

  // Book spine (thin vertical strip at the left edge)
  const spineWidth = 0.04; // even thinner spine
  const spineGeometry = new THREE.BoxGeometry(spineWidth, 2.8, coverHalfThickness * 2);
  const spineMaterial = new THREE.MeshLambertMaterial({ color: bookData.color });
  const spineMesh = new THREE.Mesh(spineGeometry, spineMaterial);
  // Position the spine at the left edge of the cover (half width = 1)
  spineMesh.position.set(-1 - spineWidth / 2, 0, 0);
  spineMesh.castShadow = true;
  bookGroup.add(spineMesh);

      // Create page stack
      createPageStack(bookGroup, bookData);
    });

    // Position books randomly
    const angle = (index / books.length) * Math.PI * 2;
    const radius = 3 + Math.random() * 2;
    bookGroup.position.set(
      Math.cos(angle) * radius,
      1.4,
      Math.sin(angle) * radius
    );
    bookGroup.rotation.y = Math.random() * Math.PI * 2;

  // store original transforms so we can restore when closing
  bookGroup.userData.originalPosition = bookGroup.position.clone();
  bookGroup.userData.originalRotation = bookGroup.rotation.clone();
  bookGroup.userData.originalQuaternion = bookGroup.quaternion.clone();

  scene.add(bookGroup);
  bookMeshes.push(bookGroup);
  });
}

function createPageStack(bookGroup, bookData) {
  const loader = new THREE.TextureLoader();
  
  // Create a white page-block to represent the volume of paper (gives visible white edges)
  const coverHalfThickness = 0.04; // matches cover thickness used earlier
  const pageBlockDepth = Math.max(0.02, coverHalfThickness * 2 - 0.01);
  const pageBlockGeometry = new THREE.BoxGeometry(1.86, 2.66, pageBlockDepth);
  const pageBlockMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const pageBlock = new THREE.Mesh(pageBlockGeometry, pageBlockMaterial);
  pageBlock.position.set(0, 0, 0); // centered between front/back covers
  pageBlock.castShadow = false;
  pageBlock.receiveShadow = true;
  bookGroup.add(pageBlock);

  // Create individual page planes on top of the white block (so interior shows image, edges stay white)
  const pageGeometry = new THREE.PlaneGeometry(1.86, 2.66);
  const pageStartZ = pageBlockDepth / 2 - 0.002; // start near front surface of the block

  bookData.pages.forEach((pageUrl, pageIndex) => {
    loader.load(pageUrl, (pageTexture) => {
      pageTexture.generateMipmaps = false;
      pageTexture.minFilter = THREE.NearestFilter;
      pageTexture.magFilter = THREE.NearestFilter;

      const pageMaterial = new THREE.MeshLambertMaterial({ map: pageTexture, side: THREE.DoubleSide });
      const pageMesh = new THREE.Mesh(pageGeometry, pageMaterial);

  // Start hidden — the interior pages should not be visible until the book is opened
  pageMesh.visible = false;

  // Create a pivot at the spine center (x=0) so pages rotate around the inner spine
  const pivot = new THREE.Object3D();
  const pivotX = 0; // center spine
  const pageZ = pageStartZ - pageIndex * 0.001; // very small step between pages
  pivot.position.set(pivotX, 0, pageZ);

  // Place the page mesh to left or right of the spine depending on parity
  const isLeft = (pageIndex % 2) === 0; // even index -> left page
  pageMesh.position.set(isLeft ? -1 : 1, 0, 0);
  // Left pages need to face outward correctly
  if (isLeft) pageMesh.rotation.y = Math.PI;
      pageMesh.userData = { pageIndex, originalRotation: 0 };

  pivot.add(pageMesh);
  bookGroup.userData.pages.push({ pivot, mesh: pageMesh, pageIndex, flipped: false });
      bookGroup.add(pivot);
    }, undefined, (err) => {
      // On error (missing image), create a plain white page so page count remains consistent
      console.warn(`Page image failed to load: ${pageUrl}`, err);
      const pageMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
      const pageMesh = new THREE.Mesh(pageGeometry, pageMaterial);

  // hidden until the book is opened
  pageMesh.visible = false;

  const pivot = new THREE.Object3D();
  const pivotX = 0;
  const pageZ = pageStartZ - pageIndex * 0.001;
  pivot.position.set(pivotX, 0, pageZ);
  const isLeft = (pageIndex % 2) === 0;
  pageMesh.position.set(isLeft ? -1 : 1, 0, 0);
  if (isLeft) pageMesh.rotation.y = Math.PI;
      pageMesh.userData = { pageIndex, originalRotation: 0, placeholder: true };

      pivot.add(pageMesh);
      bookGroup.userData.pages.push({ pivot, mesh: pageMesh, pageIndex, flipped: false });
      bookGroup.add(pivot);
    });
  });
}

// ============ Interaction Handlers ============
function onMouseMove(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  // Update raycaster
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(bookMeshes, true);

  // Change cursor on hover
  renderer.domElement.style.cursor = intersects.length > 0 ? 'pointer' : 'default';
}

function onBookClick(event) {
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(bookMeshes, true);

  if (intersects.length > 0) {
    const hit = intersects[0].object;
    // Walk up the hierarchy to find the bookGroup
    let bookGroup = hit;
    while (bookGroup && !bookGroup.userData?.bookData) {
      bookGroup = bookGroup.parent;
    }
    if (!bookGroup || !bookGroup.userData.bookData) return;

    // If already selected/open, determine which side was clicked (left/right) and flip
    if (selectedBook === bookGroup) {
      // Get mouse position in screen space and decide left/right
      const rect = renderer.domElement.getBoundingClientRect();
      const clickX = event.clientX - rect.left;
      const half = rect.width / 2;
      if (clickX > half) {
        flipForward3D(bookGroup);
      } else {
        flipBackward3D(bookGroup);
      }
    } else {
      // Select new book and open it in 3D (no modal)
      selectedBook = bookGroup;
      openBook3D(bookGroup);
      // disable controls while opening
      controls.enabled = false;
    }
    
  }
}

// Open book 3D: move it in front of camera and rotate to lay flat
function openBook3D(bookGroup) {
  // Move book to center of view in front of camera and rotate so pages face viewer
  const cameraDir = new THREE.Vector3();
  camera.getWorldDirection(cameraDir);
  // Place the book at a fixed distance in front of the camera so it fills the view
  const readDistance = 2.0; // distance from camera
  const endPos = camera.position.clone().add(cameraDir.clone().multiplyScalar(readDistance));
  // Lower slightly so book sits comfortably in frame
  endPos.y = camera.position.y - 0.6;

  const startPos = bookGroup.position.clone();
  const startQuat = bookGroup.quaternion.clone();
  // Compute end quaternion using lookAt so the book's front (+Z) faces the camera, then tilt
  // Compute quaternion so the book faces the camera. We want the book's front (+Z) to face the camera.
  const temp = new THREE.Object3D();
  temp.position.copy(endPos);
  // look at a point slightly below camera to create a subtle 'held' tilt
  const lookTarget = camera.position.clone();
  lookTarget.y -= 0.2;
  temp.lookAt(lookTarget);
  const lookQuat = temp.quaternion.clone();
  // apply an additional small tilt so the pages slope toward the viewer
  const tiltX = -Math.PI / 6; // ~30 degrees - less aggressive
  const tiltQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(tiltX, 0, 0));
  const endQuat = lookQuat.clone().multiply(tiltQuat);


  const startScale = bookGroup.scale.clone();
  // Scale so the book takes up the majority of the viewport while leaving margins
  const endScale = new THREE.Vector3(2.6, 2.6, 2.6);
  // Prepare cover animation targets (if covers exist)
  const frontMesh = bookGroup.userData.frontMesh;
  const backMesh = bookGroup.userData.backMesh;
  let frontStartPos, backStartPos, frontStartQuat, backStartQuat;
  let frontEndPos, backEndPos, frontEndQuat, backEndQuat;
  if (frontMesh && backMesh) {
    frontStartPos = frontMesh.position.clone();
    backStartPos = backMesh.position.clone();
    frontStartQuat = new THREE.Quaternion().setFromEuler(frontMesh.rotation.clone());
    backStartQuat = new THREE.Quaternion().setFromEuler(backMesh.rotation.clone());

  // push covers well outside the page spread so they cannot sit between pages
  const coverOutX = 3.0;
  const zBehind = -0.25; // push covers well behind pages

  frontEndPos = new THREE.Vector3(coverOutX, 0, zBehind);
  backEndPos = new THREE.Vector3(-coverOutX, 0, zBehind);
    frontEndQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0));
    backEndQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI, 0));
  }
  let t = 0;
  function animateToReading() {
    t += 0.06;
    if (t >= 1) {
      bookGroup.position.copy(endPos);
      bookGroup.quaternion.copy(endQuat);
      bookGroup.scale.copy(endScale);
      // reset pages
      bookGroup.userData.currentPage = 0;
      if (bookGroup.userData.pages) {
        bookGroup.userData.pages.forEach(p => {
          if (p.pivot) p.pivot.rotation.y = 0;
          p.flipped = false;
          // ensure pages are placed at correct x so two-page spread is centered
          const isLeft = (p.pageIndex % 2) === 0;
          p.mesh.position.x = isLeft ? -1 : 1;
          if (isLeft) p.mesh.rotation.y = Math.PI;
          else p.mesh.rotation.y = 0;
          p.mesh.visible = false; // will be enabled by updateSpread
        });
      }

      // show two-page spread initial (spreadIndex should be even and represent left page index)
      controls.enabled = false;
      // initialize spread index and update visible pages; ensure even starting index 0
      bookGroup.userData.spreadIndex = 0;
      updateSpread(bookGroup);
      // Ensure final cover positions are set (in case animation ended)
      if (frontMesh && backMesh) {
        frontMesh.position.copy(frontEndPos);
        frontMesh.quaternion.copy(frontEndQuat);
        backMesh.position.copy(backEndPos);
        backMesh.quaternion.copy(backEndQuat);
      }
      return;
    }
    bookGroup.position.lerpVectors(startPos, endPos, t);
    THREE.Quaternion.slerp(startQuat, endQuat, bookGroup.quaternion, t);
    bookGroup.scale.lerpVectors(startScale, endScale, t);
    // animate covers in parallel so they don't snap into awkward mid positions
    if (frontMesh && backMesh) {
      frontMesh.position.lerpVectors(frontStartPos, frontEndPos, t);
      backMesh.position.lerpVectors(backStartPos, backEndPos, t);
      THREE.Quaternion.slerp(frontStartQuat, frontEndQuat, frontMesh.quaternion, t);
      THREE.Quaternion.slerp(backStartQuat, backEndQuat, backMesh.quaternion, t);
    }
    requestAnimationFrame(animateToReading);
  }
  // reduce prominence of other books so the opened book is the focus
  bookMeshes.forEach(b => {
    if (b !== bookGroup) {
      // move slightly down/away and scale down
      b.userData._storedPos = b.position.clone();
      b.userData._storedScale = b.scale.clone();
      b.position.y = 1.1;
      b.scale.set(0.85, 0.85, 0.85);
    }
  });
  animateToReading();
}

function closeBook3D(bookGroup) {
  // Animate back to original position and re-enable controls
  const startPos = bookGroup.position.clone();
  const startQuat = bookGroup.quaternion.clone();
  const startScale = bookGroup.scale.clone();
  const endPos = bookGroup.userData.originalPosition.clone();
  const endQuat = bookGroup.userData.originalQuaternion.clone();
  const endScale = new THREE.Vector3(1,1,1);
  let t = 0;
  function animateBack() {
    t += 0.06;
    if (t >= 1) {
      bookGroup.position.copy(endPos);
      bookGroup.quaternion.copy(endQuat);
      bookGroup.scale.copy(endScale);
        // Reset pages visibility and rotations
        if (bookGroup.userData.pages) {
          bookGroup.userData.pages.forEach(p => {
            if (p.pivot) p.pivot.rotation.y = 0;
            p.mesh.visible = true; // show all when in world (small earlier code places them)
            p.flipped = false;
          });
        }
        selectedBook = null;
        // Clear spread index
        bookGroup.userData.spreadIndex = 0;
        controls.enabled = true;
        // Restore other books
        bookMeshes.forEach(b => {
          if (b !== bookGroup) {
            if (b.userData._storedPos) b.position.copy(b.userData._storedPos);
            if (b.userData._storedScale) b.scale.copy(b.userData._storedScale);
            delete b.userData._storedPos;
            delete b.userData._storedScale;
          }
        });
        // Restore covers to their original local transforms
        const fm = bookGroup.userData.frontMesh;
        const bm = bookGroup.userData.backMesh;
        if (fm && bookGroup.userData.frontMeshOriginal) {
          // reparent to bookGroup (if currently parented to a page pivot)
          if (fm.parent !== bookGroup) bookGroup.add(fm);
          fm.position.copy(bookGroup.userData.frontMeshOriginal.pos);
          fm.rotation.copy(bookGroup.userData.frontMeshOriginal.rot);
        }
        if (bm && bookGroup.userData.backMeshOriginal) {
          if (bm.parent !== bookGroup) bookGroup.add(bm);
          bm.position.copy(bookGroup.userData.backMeshOriginal.pos);
          bm.rotation.copy(bookGroup.userData.backMeshOriginal.rot);
        }
      return;
    }
    bookGroup.position.lerpVectors(startPos, endPos, t);
    THREE.Quaternion.slerp(startQuat, endQuat, bookGroup.quaternion, t);
    bookGroup.scale.lerpVectors(startScale, endScale, t);
    requestAnimationFrame(animateBack);
  }
  animateBack();
}

// Flip forward/backward functions operate on pivoted pages
function flipForward3D(bookGroup) {
  if (bookGroup.userData.isAnimating) return;
  const pages = bookGroup.userData.pages;
  let si = bookGroup.userData.spreadIndex || 0;
  // ensure even
  if (si % 2 !== 0) si -= 1;
  // target the right page of the current spread (right = si+1)
  const pageEntry = pages.find(p => p.pageIndex === si + 1);
  if (!pageEntry) return;
  bookGroup.userData.isAnimating = true;
  pageEntry.flipped = true;
  let prog = 0;
  function anim() {
    prog += 0.06;
    pageEntry.pivot.rotation.y = THREE.MathUtils.lerp(0, -Math.PI, prog);
    if (prog < 1) requestAnimationFrame(anim);
    else {
      bookGroup.userData.isAnimating = false;
      // advance by two pages (one spread)
      bookGroup.userData.spreadIndex = Math.min((pages.length - 2), si + 2);
      // ensure even
      if (bookGroup.userData.spreadIndex % 2 !== 0) bookGroup.userData.spreadIndex -= 1;
      updateSpread(bookGroup);
    }
  }
  anim();
}

function flipBackward3D(bookGroup) {
  if (bookGroup.userData.isAnimating) return;
  const pages = bookGroup.userData.pages;
  let si = bookGroup.userData.spreadIndex || 0;
  if (si % 2 !== 0) si -= 1;
  const targetIndex = si - 2;
  if (targetIndex < 0) return;
  // previous right page is targetIndex + 1
  const pageEntry = pages.find(p => p.pageIndex === targetIndex + 1);
  if (!pageEntry) return;
  bookGroup.userData.isAnimating = true;
  pageEntry.flipped = false;
  let prog = 0;
  function anim() {
    prog += 0.06;
    pageEntry.pivot.rotation.y = THREE.MathUtils.lerp(-Math.PI, 0, prog);
    if (prog < 1) requestAnimationFrame(anim);
    else {
      bookGroup.userData.isAnimating = false;
      bookGroup.userData.spreadIndex = Math.max(0, targetIndex);
      if (bookGroup.userData.spreadIndex % 2 !== 0) bookGroup.userData.spreadIndex -= 1;
      updateSpread(bookGroup);
    }
  }
  anim();
}

// Show exactly two pages (spreadIndex and spreadIndex+1) and hide others
function updateSpread(bookGroup) {
  const pages = bookGroup.userData.pages || [];
  // spreadIndex represents the left page index (even). Clamp and ensure even.
  let si = bookGroup.userData.spreadIndex || 0;
  if (si < 0) si = 0;
  if (si % 2 !== 0) si -= 1; // force even
  // don't exceed maximum left page (last possible left page = pages.length - 2)
  const maxLeft = Math.max(0, pages.length - 2);
  if (si > maxLeft) si = maxLeft - (maxLeft % 2);
  bookGroup.userData.spreadIndex = si;
  pages.forEach(p => {
    const isLeft = (p.pageIndex % 2) === 0;
    // determine visibility for exactly two pages (si, si+1)
    if (p.pageIndex === si) {
      // left page
      p.mesh.visible = true;
      if (p.pivot) p.pivot.rotation.y = 0;
      p.mesh.rotation.y = Math.PI;
      p.mesh.position.x = -1.02; // nudge inward for a believable gutter
    } else if (p.pageIndex === si + 1) {
      // right page
      p.mesh.visible = true;
      p.mesh.rotation.y = 0;
      if (p.pivot) p.pivot.rotation.y = p.flipped ? -Math.PI : 0;
      p.mesh.position.x = 1.02;
    } else {
      p.mesh.visible = false;
    }
  });
}

function highlightBook(bookGroup) {
  // Reset all books
  bookMeshes.forEach(book => {
    book.scale.set(1, 1, 1);
    book.position.y = 1.4;
  });

  // Highlight selected book
  bookGroup.scale.set(1.2, 1.2, 1.2);
  bookGroup.position.y = 2;
  
  // Animate to face camera
  const targetRotation = Math.atan2(
    camera.position.x - bookGroup.position.x,
    camera.position.z - bookGroup.position.z
  );
  
  animateBookRotation(bookGroup, targetRotation);
}

function animateBookRotation(bookGroup, targetY) {
  const startRotation = bookGroup.rotation.y;
  let progress = 0;
  
  function animate() {
    progress += 0.05;
    if (progress <= 1) {
      bookGroup.rotation.y = THREE.MathUtils.lerp(startRotation, targetY, progress);
      requestAnimationFrame(animate);
    }
  }
  animate();
}

function flipPage(bookGroup) {
  if (bookGroup.userData.isAnimating || bookGroup.userData.pages.length === 0) return;
  
  const pages = bookGroup.userData.pages;
  const currentPage = bookGroup.userData.currentPage;
  
  if (currentPage < pages.length - 1) {
    bookGroup.userData.isAnimating = true;
    const page = pages[currentPage];
    
    // Animate page flip
    let progress = 0;
    const flipDuration = 0.8;
    
    function animateFlip() {
      progress += 0.02;
      const angle = Math.sin(progress * Math.PI) * Math.PI;
      page.rotation.y = angle;
      
      if (progress < 1) {
        requestAnimationFrame(animateFlip);
      } else {
        page.rotation.y = Math.PI;
        bookGroup.userData.currentPage++;
        bookGroup.userData.isAnimating = false;
      }
    }
    animateFlip();
  }
}

// ============ Window Resize ============
function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ============ Animation Loop ============
function animate() {
  animationId = requestAnimationFrame(animate);
  
  // Update controls
  controls.update();
  
  // Slight book bobbing animation for PS2 feel
  bookMeshes.forEach((book, index) => {
    const time = Date.now() * 0.001;
    if (book !== selectedBook) {
      book.position.y = 1.4 + Math.sin(time + index) * 0.1;
      book.rotation.y += 0.005; // Slow rotation
    }
    else {
      // If this book is opened, ensure covers are positioned clearly outside the pages
      const front = book.userData.frontMesh;
      const back = book.userData.backMesh;
      if (front && back) {
        // local offsets (match updateSpread math)
        const pageHalf = 1.02;
        const coverHalf = 1.0;
        const coverMargin = 0.3;
        const zBehind = -0.12; // behind page planes
        const frontX = pageHalf + coverHalf + coverMargin;
        const backX = - (pageHalf + coverHalf + coverMargin);
        // write directly each frame so covers can't get stuck between pages
        front.position.set(frontX, 0, zBehind);
        front.rotation.set(0, 0, 0);
        if (front.parent !== book) book.add(front);
        back.position.set(backX, 0, zBehind);
        back.rotation.set(0, Math.PI, 0);
        if (back.parent !== book) book.add(back);
      }
    }
  });
  
  renderer.render(scene, camera);
}

// ============ Modal Integration ============
// Keep existing modal functionality
const previewModal = document.getElementById('modal');
const selectModal = document.getElementById('select-modal');
const titleEl = document.getElementById('modal-title');
const pagesEl = document.getElementById('modal-pages');
const bindEl = document.getElementById('modal-binding');
const priceEl = document.getElementById('modal-price');
const detailsEl = document.getElementById('modal-details');
const leftImg = document.getElementById('flip-left');
const rightImg = document.getElementById('flip-right');
const closeBtns = document.querySelectorAll('.close');
let currentBook, currentPage;

const blackoutOverlay = document.getElementById('blackout-overlay');
const blackoutTitle = document.getElementById('blackout-title');

function triggerBlackoutAndModal(b) {
  blackoutTitle.textContent = b.title;
  blackoutOverlay.classList.remove('hidden');
  blackoutOverlay.style.opacity = '1';

  setTimeout(() => {
    blackoutOverlay.style.opacity = '0';
    openPreview(b);
    setTimeout(() => {
      blackoutOverlay.classList.add('hidden');
    }, 800);
  }, 500);
}

function openPreview(b) {
  currentBook = b;
  currentPage = 0;
  titleEl.textContent = b.title;
  pagesEl.textContent = `${b.pageCount} pp`;
  bindEl.textContent = b.binding;
  priceEl.textContent = b.price;
  detailsEl.textContent = b.description;

  const modalContent = document.querySelector('.modal-content');
  if (b && b.bgColor) {
    modalContent.style.background = b.bgColor;
  } else {
    modalContent.style.background = '#fff';
  }
  // create or update a bottom-left info panel inside the preview modal
  let infoPanel = document.querySelector('.modal-info');
  if (!infoPanel) {
    infoPanel = document.createElement('div');
    infoPanel.className = 'modal-info';
    Object.assign(infoPanel.style, {
      position: 'absolute',
      left: '12px',
      bottom: '12px',
      maxWidth: '40%',
      color: '#111',
      background: 'rgba(255,255,255,0.92)',
      padding: '10px',
      borderRadius: '6px',
      boxShadow: '0 6px 18px rgba(0,0,0,0.25)',
      fontFamily: 'sans-serif',
      zIndex: 3000
    });
    modalContent.appendChild(infoPanel);
  }
  // populate fields
  infoPanel.innerHTML = `<div style="font-weight:700;margin-bottom:6px;">${escapeHtml(b.title)}</div>
    <div style="font-size:13px;margin-bottom:8px;color:#222;">${escapeHtml(shorten(b.description, 220))}</div>
    <div style="font-size:12px;color:#333;">Binding: <strong>${escapeHtml(b.binding || '')}</strong></div>
    <div style="font-size:12px;color:#333;">Pages: <strong>${escapeHtml(String(b.pageCount || ''))}</strong></div>
    <div style="font-size:12px;color:#333;">Price: <strong>${escapeHtml(b.price || '')}</strong></div>`;
  updateFlip();
  previewModal.classList.remove('hidden');
}

function closePreview() { 
  previewModal.classList.add('hidden');
  selectedBook = null;
  // Reset all books
  bookMeshes.forEach(book => {
    book.scale.set(1, 1, 1);
    book.position.y = 1.4;
  });
  // hide/clear modal info panel
  const ip = document.querySelector('.modal-info');
  if (ip && ip.parentNode) ip.parentNode.removeChild(ip);
}

function updateFlip() {
  leftImg.src = (currentBook && currentBook.pages[currentPage]) ? currentBook.pages[currentPage] : '';
  rightImg.src = (currentBook && currentBook.pages[currentPage + 1]) ? currentBook.pages[currentPage + 1] : '';
}

// Event listeners for modal
rightImg.addEventListener('click', e => { 
  e.stopPropagation(); 
  if (currentBook && currentPage + 2 < currentBook.pages.length) { 
    currentPage += 2; 
    updateFlip();
    
    // Also flip page in 3D if book is selected
    if (selectedBook) {
      flipPage(selectedBook);
    }
  }
});

leftImg.addEventListener('click', e => { 
  e.stopPropagation(); 
  if (currentBook && currentPage - 2 >= 0) { 
    currentPage -= 2; 
    updateFlip(); 
  }
});

closeBtns.forEach(btn => btn.addEventListener('click', e => { 
  e.target.dataset.close === 'preview' ? closePreview() : closeSelection(); 
}));

previewModal.addEventListener('click', e => e.target === previewModal && closePreview());

// ============ Buy Button Functionality ============
const buyBtn = document.getElementById('buy-button');
const selectForm = document.getElementById('select-form');

buyBtn.addEventListener('click', openSelection);

function openSelection() {
  selectForm.innerHTML = '';
  books.forEach(b => {
    const label = document.createElement('label');
    const chk = document.createElement('input'); 
    chk.type = 'checkbox'; 
    chk.value = b.id;
    label.append(chk, ' ' + b.title);
    selectForm.append(label, document.createElement('br'));
  });
  selectModal.classList.remove('hidden');
}

function closeSelection() { selectModal.classList.add('hidden'); }

selectModal.addEventListener('click', e => e.target === selectModal && closeSelection());

selectForm.addEventListener('submit', e => {
  e.preventDefault();
  const chosen = Array.from(selectForm.querySelectorAll('input:checked')).map(i => parseInt(i.value));
  if (!chosen.length) { alert('Please select at least one book.'); return; }
  const titles = chosen.map(id => books.find(b => b.id === id).title).join('%0D%0A');
  const subject = encodeURIComponent('Book Purchase Request');
  window.location.href = `mailto:?subject=${subject}&body=${titles}`;
});

// ============ Initialize ============
window.addEventListener('DOMContentLoaded', () => {
  init3DScene();
});
