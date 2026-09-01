/* ============================================================
   Plate & Progress — STATS 3D body module
   ------------------------------------------------------------
   This file is the ENTIRE "model layer" for the interactive 3D
   body on the STATS tab. It knows nothing about splits, sets,
   exercises, or IndexedDB — index.html owns all of that and only
   talks to this module through Stats3D.mount(container, callbacks).

   MODEL SWAP (procedural -> GLB), READ ME:
   The bundled production model is body.glb. It contains six named selectable
   meshes (PXP_chest, PXP_back, PXP_shoulders, PXP_arms, PXP_legs, PXP_core).
   The procedural model remains only as a graceful fallback if the GLB or
   loader cannot be loaded. Selection, highlighting, stats, the callout,
   gestures, and the radar chart all consume the same adapter shape
   ({root, regions, anchors}) regardless of source.
   ============================================================ */

window.Stats3D = (function () {
  'use strict';

  var CATEGORIES = ['chest', 'back', 'shoulders', 'arms', 'legs', 'core'];

  // ---- adapter mapping: (current or future) mesh/node name -> category ----
  // Keys are matched against a normalized (lowercased, spaces/dashes -> underscore)
  // version of each mesh name, first by exact match then by "contains".
  var MUSCLE_MESH_TO_CATEGORY = {
    pxp_chest: 'chest', pxp_back: 'back', pxp_shoulders: 'shoulders',
    pxp_arms: 'arms', pxp_legs: 'legs', pxp_core: 'core',
    pectoralis_major_l: 'chest', pectoralis_major_r: 'chest', pectoralis: 'chest',
    pec_l: 'chest', pec_r: 'chest', pecs: 'chest', chest: 'chest',

    latissimus_dorsi_l: 'back', latissimus_dorsi_r: 'back', latissimus: 'back',
    lats_l: 'back', lats_r: 'back', lats: 'back', trapezius: 'back', traps: 'back',
    rhomboid: 'back', rhomboids: 'back', erector_spinae: 'back', lower_back: 'back', back: 'back',

    deltoid_anterior_l: 'shoulders', deltoid_anterior_r: 'shoulders',
    deltoid_lateral_l: 'shoulders', deltoid_lateral_r: 'shoulders',
    deltoid_posterior_l: 'shoulders', deltoid_posterior_r: 'shoulders',
    deltoid_l: 'shoulders', deltoid_r: 'shoulders', deltoids: 'shoulders',
    delt_l: 'shoulders', delt_r: 'shoulders', shoulder: 'shoulders', shoulders: 'shoulders',

    biceps_l: 'arms', biceps_r: 'arms', biceps: 'arms',
    triceps_l: 'arms', triceps_r: 'arms', triceps: 'arms',
    forearm_l: 'arms', forearm_r: 'arms', forearms: 'arms', arm_l: 'arms', arm_r: 'arms', arms: 'arms',
    hand_l: 'arms', hand_r: 'arms',

    quadriceps_l: 'legs', quadriceps_r: 'legs', quad_l: 'legs', quad_r: 'legs', quads: 'legs',
    hamstring_l: 'legs', hamstring_r: 'legs', hamstrings: 'legs',
    glute_l: 'legs', glute_r: 'legs', glutes: 'legs',
    calf_l: 'legs', calf_r: 'legs', calves: 'legs', leg_l: 'legs', leg_r: 'legs', legs: 'legs',
    foot_l: 'legs', foot_r: 'legs',

    abdominal: 'core', abdominals: 'core', rectus_abdominis: 'core',
    oblique_l: 'core', oblique_r: 'core', obliques: 'core', abs: 'core', core: 'core'
  };

  function normalizeKey(name) {
    return String(name || '').toLowerCase().trim().replace(/[\s\-]+/g, '_');
  }
  function categoryForMeshName(name) {
    var key = normalizeKey(name);
    if (!key) return null;
    if (MUSCLE_MESH_TO_CATEGORY[key]) return MUSCLE_MESH_TO_CATEGORY[key];
    for (var k in MUSCLE_MESH_TO_CATEGORY) {
      if (key.indexOf(k) !== -1) return MUSCLE_MESH_TO_CATEGORY[k];
    }
    return null;
  }

  // ---------------------------------------------------------------
  // PROCEDURAL BODY — real named/selectable meshes, no external asset
  // ---------------------------------------------------------------
  function buildProceduralBody() {
    var root = new THREE.Group();
    var regions = { chest: [], back: [], shoulders: [], arms: [], legs: [], core: [] };
    var allMeshes = []; // {mesh, category}

    function seg(radial, cap) { return { r: radial || 12, c: cap || 4 }; }

    function capsuleGeo(radius, length, quality) {
      quality = quality || seg();
      if (THREE.CapsuleGeometry) {
        return new THREE.CapsuleGeometry(radius, length, quality.c, quality.r);
      }
      // Fallback for older three builds without CapsuleGeometry.
      return new THREE.CylinderGeometry(radius, radius, length + radius * 1.4, quality.r, 1, false);
    }

    function addMesh(category, geometry, x, y, z, rotX, rotY, rotZ, scale) {
      var mesh = new THREE.Mesh(geometry);
      mesh.position.set(x, y, z);
      if (rotX) mesh.rotation.x = rotX;
      if (rotY) mesh.rotation.y = rotY;
      if (rotZ) mesh.rotation.z = rotZ;
      if (scale) mesh.scale.set(scale[0], scale[1], scale[2]);
      mesh.userData.category = category || null;
      root.add(mesh);
      allMeshes.push({ mesh: mesh, category: category || null });
      if (category) regions[category].push(mesh);
      return mesh;
    }
    // mirrors across x=0
    function addMirrored(category, geometry, x, y, z, rotX, rotY, rotZ, scale) {
      addMesh(category, geometry, x, y, z, rotX, rotY, rotZ, scale);
      addMesh(category, geometry.clone(), -x, y, z, rotX, rotY, rotZ ? -rotZ : rotZ, scale);
    }

    // ---- neutral connective shapes (rib cage, pelvis, neck, head, feet) ----
    addMesh(null, new THREE.SphereGeometry(0.105, 20, 16), 0, 1.665, 0.01); // head
    addMesh(null, capsuleGeo(0.045, 0.05), 0, 1.535, 0.0); // neck
    addMesh(null, new THREE.CylinderGeometry(0.15, 0.19, 0.34, 16), 0, 1.28, 0, 0, 0, 0); // rib cage base
    addMesh(null, new THREE.CylinderGeometry(0.135, 0.115, 0.22, 16), 0, 0.98, 0); // waist/pelvis
    addMirrored(null, new THREE.BoxGeometry(0.075, 0.045, 0.19), 0.09, 0.025, 0.06); // feet

    // ---- CHEST: pectorals ----
    addMirrored('chest', capsuleGeo(0.095, 0.14, seg(10, 3)), 0.135, 1.375, 0.115, 0, 0, -0.32);

    // ---- SHOULDERS: deltoids ----
    addMirrored('shoulders', new THREE.SphereGeometry(0.09, 18, 14), 0.275, 1.44, 0.0);

    // ---- BACK: traps, lats, lower back ----
    addMesh('back', new THREE.ConeGeometry(0.16, 0.22, 4, 1), 0, 1.52, -0.09, Math.PI, Math.PI / 4, 0); // trapezius wedge
    addMirrored('back', capsuleGeo(0.08, 0.2, seg(10, 3)), 0.175, 1.2, -0.1, 0, 0, 0.12);   // lats
    addMesh('back', new THREE.BoxGeometry(0.16, 0.16, 0.09), 0, 1.035, -0.12);              // lower back / erectors

    // ---- CORE: abdominals + obliques ----
    for (var row = 0; row < 3; row++) {
      addMirrored('core', new THREE.BoxGeometry(0.058, 0.06, 0.05), 0.04, 1.31 - row * 0.075, 0.155);
    }
    addMirrored('core', capsuleGeo(0.045, 0.14, seg(8, 3)), 0.145, 1.15, 0.09, 0, 0, 0.1);

    // ---- ARMS: upper arm, forearm, hand ----
    addMirrored('arms', capsuleGeo(0.062, 0.22, seg(10, 3)), 0.31, 1.28, 0, 0, 0, 0.06);   // upper arm
    addMirrored('arms', capsuleGeo(0.05, 0.21, seg(10, 3)), 0.335, 0.995, 0.02, 0, 0, 0.03); // forearm
    addMirrored('arms', new THREE.SphereGeometry(0.04, 12, 10), 0.345, 0.85, 0.03);          // hand

    // ---- LEGS: glutes, thigh, calf ----
    addMirrored('legs', new THREE.SphereGeometry(0.095, 16, 12), 0.115, 0.87, -0.075);     // glute
    addMirrored('legs', capsuleGeo(0.105, 0.28, seg(12, 4)), 0.115, 0.62, 0.01, 0, 0, 0.015); // thigh
    addMirrored('legs', capsuleGeo(0.075, 0.28, seg(12, 4)), 0.12, 0.27, -0.01);            // calf

    // ---- anchors: one empty per category, positioned at an outward representative point ----
    var anchors = {};
    var anchorOffsets = {
      chest: [0.13, 1.37, 0.22],
      back: [0, 1.2, -0.24],
      shoulders: [0.29, 1.46, 0.08],
      arms: [0.36, 1.05, 0.1],
      legs: [0.13, 0.55, 0.14],
      core: [0.14, 1.18, 0.2]
    };
    CATEGORIES.forEach(function (c) {
      var a = new THREE.Object3D();
      var o = anchorOffsets[c];
      a.position.set(o[0], o[1], o[2]);
      root.add(a);
      anchors[c] = a;
    });

    return { root: root, regions: regions, anchors: anchors, allMeshes: allMeshes, source: 'procedural' };
  }

  // ---------------------------------------------------------------
  // GLB LOADER (used automatically if body.glb + GLTFLoader exist)
  // ---------------------------------------------------------------
  // Build render meshes from the existing GLB geometry without modifying or
  // replacing body.glb. A few of the source meshes contain disconnected stray
  // anatomy (for example the head inside the chest mesh and feet inside the
  // arms mesh), so triangles are separated into the correct selectable region
  // at render time.
  function classifyTriangle(sourceCategory, a, b, c) {
    var x = (a.x + b.x + c.x) / 3;
    var y = (a.y + b.y + c.y) / 3;
    var z = (a.z + b.z + c.z) / 3;
    var ax = Math.abs(x);

    // The source GLB uses a few meshes as containers for multiple disconnected
    // anatomical pieces. Selection is therefore classified per triangle rather
    // than treating the whole source mesh as one muscle group.
    //
    // CHEST: its pectoral geometry ends around y=1.53. Geometry above that
    // height is the head/neck assembly and must remain visible but neutral.
    if (sourceCategory === 'chest' && y > 1.535) return null;

    // BACK: the source back mesh contains tiny disconnected ear pieces. They
    // sit laterally beside the head, slightly behind the body center, around
    // y=1.44 and z<0.  Exclude only that small anatomical pocket.
    if (sourceCategory === 'back' &&
        y > 1.405 && y < 1.475 &&
        ax > 0.118 && ax < 0.155 &&
        z < 0.005) return null;

    // SHOULDERS: in this GLB the PXP_shoulders container includes both the
    // deltoid caps and the upper-arm/biceps/triceps geometry. Keep the actual
    // shoulder caps as SHOULDERS, but move the lower portion of that container
    // into ARMS. This is based on the model's anatomical Y ranges, not on
    // screen coordinates, so it continues to work while the body rotates.
    // The shoulder caps occupy the upper ~1.41-1.53 range; the upper arms sit
    // below that and connect down toward the elbows.
    if (sourceCategory === 'shoulders' && y < 1.41) return 'arms';

    // ARMS: the source arms mesh also contains disconnected feet/lower-leg
    // geometry. Move everything below the knee/hand transition into LEGS.
    if (sourceCategory === 'arms' && y < 0.55) return 'legs';

    return sourceCategory;
  }

  function makeCategoryGeometry(sourceGeometry, sourceCategory) {
    var src = sourceGeometry.index ? sourceGeometry.toNonIndexed() : sourceGeometry.clone();
    var pos = src.getAttribute('position');
    if (!pos) return {};

    var buckets = {};
    var va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
    for (var i = 0; i < pos.count; i += 3) {
      va.fromBufferAttribute(pos, i);
      vb.fromBufferAttribute(pos, i + 1);
      vc.fromBufferAttribute(pos, i + 2);
      var cat = classifyTriangle(sourceCategory, va, vb, vc);
      if (!buckets[cat || '__neutral']) buckets[cat || '__neutral'] = [];
      var bucket = buckets[cat || '__neutral'];
      bucket.push(
        va.x, va.y, va.z,
        vb.x, vb.y, vb.z,
        vc.x, vc.y, vc.z
      );
    }
    src.dispose();

    var result = {};
    Object.keys(buckets).forEach(function (key) {
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(buckets[key], 3));
      g.computeVertexNormals();
      g.computeBoundingSphere();
      result[key === '__neutral' ? null : key] = g;
    });
    return result;
  }

  function tryLoadGLB() {
    return new Promise(function (resolve) {
      if (!window.THREE || !THREE.GLTFLoader) { resolve(null); return; }
      try {
        var loader = new THREE.GLTFLoader();
        loader.load('./body.glb', function (gltf) {
          try {
            var root = gltf.scene || gltf.scenes[0];
            var regions = { chest: [], back: [], shoulders: [], arms: [], legs: [], core: [] };
            var allMeshes = [];
            var sourceMeshes = [];

            root.traverse(function (obj) {
              if (obj.isMesh) sourceMeshes.push(obj);
            });

            sourceMeshes.forEach(function (sourceMesh) {
              var sourceCategory = categoryForMeshName(sourceMesh.name);
              var sourceParent = sourceMesh.parent;
              var derived = makeCategoryGeometry(sourceMesh.geometry, sourceCategory);
              var sourceWorld = sourceMesh.matrixWorld.clone();

              // The source mesh is only the input. Its render geometry is split
              // into clean selectable regions, while body.glb remains untouched.
              Object.keys(derived).forEach(function (key) {
                var cat = key === 'null' ? null : key;
                var mesh = new THREE.Mesh(derived[key]);
                mesh.name = sourceMesh.name + (cat ? '__' + cat : '__neutral');
                mesh.userData.category = cat;
                mesh.matrixAutoUpdate = false;
                mesh.matrix.copy(sourceMesh.matrix);
                mesh.matrixWorld.copy(sourceWorld);
                mesh.position.copy(sourceMesh.position);
                mesh.quaternion.copy(sourceMesh.quaternion);
                mesh.scale.copy(sourceMesh.scale);
                mesh.matrixAutoUpdate = true;
                if (sourceParent) sourceParent.add(mesh);
                allMeshes.push({ mesh: mesh, category: cat });
                if (cat && regions[cat]) regions[cat].push(mesh);
              });

              if (sourceMesh.parent) sourceMesh.parent.remove(sourceMesh);
              if (sourceMesh.geometry) sourceMesh.geometry.dispose();
            });

            var box = new THREE.Box3().setFromObject(root);
            var anchors = {};
            CATEGORIES.forEach(function (c) {
              var a = new THREE.Object3D();
              if (regions[c].length) {
                var center = new THREE.Vector3();
                var tmp = new THREE.Box3();
                regions[c].forEach(function (m) { tmp.expandByObject(m); });
                tmp.getCenter(center);
                a.position.copy(center);
                // Front-facing leader-line origin. Keep the anchor close to the
                // actual region so it remains useful while the body rotates.
                a.position.z += Math.max(0.055, (box.max.z - box.min.z) * 0.055);
              }
              root.add(a);
              anchors[c] = a;
            });

            resolve({ root: root, regions: regions, anchors: anchors, allMeshes: allMeshes, source: 'glb' });
          } catch (e) {
            console.error('Stats3D: body.glb render preparation failed.', e);
            resolve(null);
          }
        }, undefined, function () { resolve(null); });
      } catch (e) { resolve(null); }
    });
  }

  function loadBodyModel() {
    return tryLoadGLB().then(function (glbModel) {
      return glbModel || buildProceduralBody();
    });
  }

  // ---------------------------------------------------------------
  // VIEW: renderer, camera, gesture handling, highlighting, projection
  // ---------------------------------------------------------------
  function View(container, callbacks) {
    this.container = container;
    this.callbacks = callbacks || {};
    this.disposed = false;
    this.selected = null;
    this.model = null;
    this._pointers = new Map();
    this._pinchStartDist = 0;
    this._pinchStartDistance = 0;
    this._dragStart = null;
    this._dragMoved = false;

    this.theta = Math.PI * 0.18;   // horizontal angle
    this.phi = Math.PI * 0.47;     // vertical angle (0 = top, PI = bottom)
    // The GLB is ~1.77 units tall. Start slightly farther back so the full
    // figure (including feet) is visible without sacrificing muscle detail.
    this.distance = 3.05;
    this.minDistance = 2.0;
    this.maxDistance = 4.8;
    this.target = new THREE.Vector3(0, 0.90, 0);

    this._initThree();
    this._bindEvents();
    this._loadModel();
    this._tick = this._tick.bind(this);
    this._raf = requestAnimationFrame(this._tick);
  }

  View.prototype._initThree = function () {
    var w = this.container.clientWidth || 320;
    var h = this.container.clientHeight || 400;

    var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h);
    if ('outputColorSpace' in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
    else if ('outputEncoding' in renderer) renderer.outputEncoding = THREE.sRGBEncoding;
    // Keep the neutral gray of the source/reference model. ACES filmic tone
    // mapping made this small viewport noticeably darker than the reference,
    // so use the renderer's native output transform here.
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.toneMappingExposure = 1.0;
    if (THREE.PCFSoftShadowMap) renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.enabled = true;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.touchAction = 'none';
    this.container.appendChild(renderer.domElement);
    this.renderer = renderer;
    this.canvas = renderer.domElement;

    var scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0b0d);
    if (THREE.Fog) scene.fog = new THREE.Fog(0x0a0b0d, 3.2, 6.5);
    this.scene = scene;

    var camera = new THREE.PerspectiveCamera(32, w / h, 0.1, 20);
    this.camera = camera;

    // Soft studio lighting designed to reproduce the light-gray sculpted
    // reference model while keeping the app's existing dark background.
    var hemi = new THREE.HemisphereLight(0xffffff, 0x34373b, 1.25);
    hemi.position.set(0, 2.5, 0);
    scene.add(hemi);

    var ambient = new THREE.AmbientLight(0xffffff, 0.32);
    scene.add(ambient);

    var key = new THREE.DirectionalLight(0xffffff, 1.35);
    key.position.set(2.5, 3.6, 4.0);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.1;
    key.shadow.camera.far = 8;
    scene.add(key);

    var fill = new THREE.DirectionalLight(0xffffff, 0.78);
    fill.position.set(-3.0, 2.3, 3.0);
    scene.add(fill);

    var rim = new THREE.DirectionalLight(0xffffff, 0.50);
    rim.position.set(-1.8, 2.8, -4.0);
    scene.add(rim);

    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();

    // Studio-sculpt material. The GLB's source material is deliberately not
    // reused because it renders too dark in this app. Each selectable region
    // receives its own material instance so selection can never mutate another
    // region's appearance.
    var makeBodyMaterial = function (color, roughness, metalness, emissive, emissiveIntensity) {
      return new THREE.MeshStandardMaterial({
        color: color,
        roughness: roughness,
        metalness: metalness,
        flatShading: false,
        emissive: emissive || 0x000000,
        emissiveIntensity: emissiveIntensity || 0
      });
    };
    // Close to the reference GLB's neutral clay/plaster appearance: bright
    // enough to show the sculpted anatomy on a dark viewport, but not glossy.
    this.matNormal = makeBodyMaterial(0xb9bbbd, 0.66, 0.0);
    this.matNeutral = makeBodyMaterial(0xb1b3b5, 0.69, 0.0);
    this.matSelected = makeBodyMaterial(0xead27a, 0.52, 0.0, 0xdca51d, 0.18);
    this.matDimmed = makeBodyMaterial(0x85888b, 0.72, 0.0);
    this.matNeutralDimmed = makeBodyMaterial(0x7c7f82, 0.74, 0.0);

    this._updateCamera();
  };

  View.prototype._loadModel = function () {
    var self = this;
    loadBodyModel().then(function (model) {
      if (self.disposed) return;
      self.model = model;
      model.allMeshes.forEach(function (entry) {
        // Each derived GLB region gets its own material instance.
        entry.mesh.material = (entry.category ? self.matNormal : self.matNeutral).clone();
        entry.mesh.castShadow = true;
        entry.mesh.receiveShadow = true;
      });
      self.scene.add(model.root);
      // Fit the real GLB once using its measured bounds. This avoids the old
      // fixed camera distance cropping the feet or leaving the head too close
      // to the top of the STATS visualization area.
      var bounds = new THREE.Box3().setFromObject(model.root);
      var size = bounds.getSize(new THREE.Vector3());
      var center = bounds.getCenter(new THREE.Vector3());
      var fovRad = self.camera.fov * Math.PI / 180;
      var fitDistance = (size.y * 0.64) / Math.tan(fovRad / 2);
      self.target.copy(center);
      self.target.y += size.y * 0.015;
      self.distance = Math.max(self.minDistance, Math.min(self.maxDistance, fitDistance));
      self._updateCamera();
      if (self.callbacks.onReady) self.callbacks.onReady(model.source);
    }).catch(function (err) {
      console.error('Stats3D: model failed to load', err);
      if (self.callbacks.onFail) self.callbacks.onFail(err);
    });
  };

  View.prototype._updateCamera = function () {
    var phi = Math.max(0.35, Math.min(Math.PI - 0.35, this.phi));
    this.phi = phi;
    var sinPhi = Math.sin(phi);
    var x = this.target.x + this.distance * sinPhi * Math.sin(this.theta);
    var y = this.target.y + this.distance * Math.cos(phi);
    var z = this.target.z + this.distance * sinPhi * Math.cos(this.theta);
    this.camera.position.set(x, y, z);
    this.camera.lookAt(this.target);
  };

  View.prototype._bindEvents = function () {
    var self = this;
    var el = this.canvas;

    function pos(e) { return { x: e.clientX, y: e.clientY }; }

    this._onPointerDown = function (e) {
      el.setPointerCapture && el.setPointerCapture(e.pointerId);
      self._pointers.set(e.pointerId, pos(e));
      if (self._pointers.size === 1) {
        self._dragStart = pos(e);
        self._dragMoved = false;
        self._dragStartTheta = self.theta;
        self._dragStartPhi = self.phi;
      } else if (self._pointers.size === 2) {
        self._pinchStartDistance = self._currentPinchDistance();
        self._pinchStartCameraDistance = self.distance;
      }
      e.preventDefault && e.preventDefault();
    };

    this._onPointerMove = function (e) {
      if (!self._pointers.has(e.pointerId)) return;
      self._pointers.set(e.pointerId, pos(e));

      if (self._pointers.size >= 2) {
        var d = self._currentPinchDistance();
        if (self._pinchStartDistance > 0) {
          var ratio = self._pinchStartDistance / Math.max(1, d);
          var next = self._pinchStartCameraDistance * ratio;
          self.distance = Math.max(self.minDistance, Math.min(self.maxDistance, next));
          self._updateCamera();
        }
        return;
      }

      if (!self._dragStart) return;
      var dx = e.clientX - self._dragStart.x;
      var dy = e.clientY - self._dragStart.y;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) self._dragMoved = true;
      if (self._dragMoved) {
        self.theta = self._dragStartTheta - dx * 0.008;
        self.phi = self._dragStartPhi - dy * 0.008;
        self._updateCamera();
      }
    };

    this._onPointerUp = function (e) {
      var wasSingle = self._pointers.size === 1;
      self._pointers.delete(e.pointerId);
      if (wasSingle && self._dragStart && !self._dragMoved) {
        self._handleTap(e);
      }
      if (self._pointers.size < 2) self._pinchStartDistance = 0;
      if (self._pointers.size === 0) self._dragStart = null;
    };

    el.addEventListener('pointerdown', this._onPointerDown);
    el.addEventListener('pointermove', this._onPointerMove);
    el.addEventListener('pointerup', this._onPointerUp);
    el.addEventListener('pointercancel', this._onPointerUp);
    el.addEventListener('pointerleave', function (e) { if (self._pointers.size <= 1) self._onPointerUp(e); });

    this._onWheel = function (e) {
      e.preventDefault();
      var next = self.distance + e.deltaY * 0.0016 * self.distance;
      self.distance = Math.max(self.minDistance, Math.min(self.maxDistance, next));
      self._updateCamera();
    };
    el.addEventListener('wheel', this._onWheel, { passive: false });

    this._onResize = function () { self.resize(); };
    window.addEventListener('resize', this._onResize);
  };

  View.prototype._currentPinchDistance = function () {
    var pts = Array.from(this._pointers.values());
    if (pts.length < 2) return 0;
    var dx = pts[0].x - pts[1].x, dy = pts[0].y - pts[1].y;
    return Math.sqrt(dx * dx + dy * dy);
  };

  View.prototype._handleTap = function (e) {
    if (!this.model) return;
    var rect = this.canvas.getBoundingClientRect();
    this.ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.ndc, this.camera);
    var hits = this.raycaster.intersectObjects(this.model.root.children, true);
    var category = null;
    for (var i = 0; i < hits.length; i++) {
      var cat = hits[i].object && hits[i].object.userData ? hits[i].object.userData.category : null;
      if (cat) { category = cat; break; }
    }
    if (category) this.setSelected(category === this.selected ? this.selected : category);
    else this.setSelected(null);
  };

  View.prototype.setSelected = function (category) {
    this.selected = category;
    if (this.model) {
      this.model.allMeshes.forEach(function (entry) {
        var m = entry.mesh, cat = entry.category;
        if (!category) {
          m.material = (cat ? this.matNormal : this.matNeutral).clone();
          return;
        }
        if (cat === category) m.material = this.matSelected.clone();
        else m.material = (cat ? this.matDimmed : this.matNeutralDimmed).clone();
      }, this);
    }
    if (this.callbacks.onSelect) this.callbacks.onSelect(category);
  };

  View.prototype._tick = function () {
    if (this.disposed) return;
    this.renderer.render(this.scene, this.camera);
    if (this.selected && this.model && this.model.anchors[this.selected]) {
      var anchor = this.model.anchors[this.selected];
      var worldPos = new THREE.Vector3();
      anchor.getWorldPosition(worldPos);
      var screen = worldPos.clone().project(this.camera);
      var rect = this.canvas.getBoundingClientRect();
      var x = (screen.x * 0.5 + 0.5) * rect.width;
      var y = (-screen.y * 0.5 + 0.5) * rect.height;
      var inFront = screen.z < 1;
      if (this.callbacks.onAnchorUpdate) {
        this.callbacks.onAnchorUpdate(this.selected, { x: x, y: y, w: rect.width, h: rect.height, visible: inFront });
      }
    }
    this._raf = requestAnimationFrame(this._tick);
  };

  View.prototype.resize = function () {
    if (this.disposed) return;
    var w = this.container.clientWidth || 320;
    var h = this.container.clientHeight || 400;
    if (w < 1 || h < 1) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  View.prototype.destroy = function () {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._onResize);
    var el = this.canvas;
    el.removeEventListener('pointerdown', this._onPointerDown);
    el.removeEventListener('pointermove', this._onPointerMove);
    el.removeEventListener('pointerup', this._onPointerUp);
    el.removeEventListener('pointercancel', this._onPointerUp);
    el.removeEventListener('wheel', this._onWheel);
    [this.matNormal, this.matNeutral, this.matSelected, this.matDimmed, this.matNeutralDimmed].forEach(function (m) { m.dispose(); });
    if (this.model) {
      this.model.root.traverse(function (obj) { if (obj.isMesh && obj.geometry) obj.geometry.dispose(); });
    }
    this.renderer.dispose();
    if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
  };

  function webglAvailable() {
    try {
      var c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
    } catch (e) { return false; }
  }

  return {
    CATEGORIES: CATEGORIES,
    categoryForMeshName: categoryForMeshName,
    webglAvailable: webglAvailable,
    mount: function (container, callbacks) {
      if (!window.THREE || !webglAvailable()) return null;
      return new View(container, callbacks);
    }
  };
})();
