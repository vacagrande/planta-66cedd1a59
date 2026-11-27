// Recorrido 3D del Centro Oftálmico: una o dos plantas, maqueta girable, caminar por dentro y paseo guiado
// ambiente por ambiente.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { Reflector } from "three/addons/objects/Reflector.js";
import { Plano } from "./plano.js";
import { Mapa, Caminante } from "./caminar.js";

const $ = (id) => document.getElementById(id);
const lienzo = $("lienzo");
const TACTIL = matchMedia("(pointer: coarse)").matches;
const LIVIANO = TACTIL || Math.min(screen.width, screen.height) < 600;          // celular o tableta: sin reflejo del piso
const QUIETO = matchMedia("(prefers-reduced-motion: reduce)").matches;
// La versión que se comparte con el arquitecto lleva una sola planta y ninguna pestaña: herramientas/publicar.py
// (con --solo-planos) cambia null por "a" y quita los trozos marcados para esa versión.
const SOLO = "a";

// Las dos plantas. Cada una tiene su carpeta con planta.json, materiales.json, la luz horneada (lm_*.webp), el modelo
// y paseo.json. Los renders fijos (img/…) los arma herramientas/publicar.py.
const VERSIONES = {
  a: {
    nombre: "Según planos", dir: "modelo", img: "img", titulo: "PLANTA", sub: "ESC 1:100 · 26 NOV 2026",
    resumen: "Planta completa · 41,5 × 20,9 m",
    firma: "Plano: Durán-Ballén Arquitecto & Cía., 26/nov/2026 · a escala según las medidas rotuladas · muebles y acabados ilustrativos",
    imagenes: [["01-maqueta", "Maqueta"], ["02-maqueta-noreste", "Maqueta desde el noreste"],
      ["03-hall", "Llegada por el hall de ascensores"], ["04-sala", "Sala de espera"], ["05-sala-entrada", "Sala de espera hacia la entrada"],
      ["06-recepcion", "Recepción"], ["07-consultorio-4", "Consultorio 4"], ["08-consultorio-1", "Consultorio 1"],
      ["09-examenes-especiales", "Exámenes especiales"], ["10-quirofano-1", "Quirófano 1"], ["11-optica", "Óptica"],
      ["12-pasillo-norte", "Pasillo norte"], ["13-administracion", "Administración"], ["14-estar-medico", "Estar médico"]],
  },
};
// El modelo 3D. En la versión publicada viaja como texto (base64) porque claude.ai no sirve archivos .glb;
// herramientas/publicar.py cambia este nombre por "centro-glb.txt".
const ARCHIVO_MODELO = "centro.glb";

const CON_LUZ_TEXTURA = new Set(["muros", "pisos", "techo"]);
const SOLO_ADENTRO = new Set(["techo", "detalles_techo", "lamparas"]);       // se ocultan al mirar desde arriba
const ZONAS = { clinica: "Área clínica", quirurgica: "Área quirúrgica", optica: "Óptica", servicio: "Servicio", humeda: "Baño", comun: "Zona común del edificio" };
// «Según planos»: qué ambientes llevan nombre sobre la maqueta y cómo se ordena la lista (la otra planta trae los suyos)
const ETIQUETAS_A = ["sala", "c1", "c2", "natalia", "c3", "c4", "c5", "examenes_esp", "q1", "q2", "administracion", "optica", "estar",
  "pre_op", "post_op", "insumos", "vest_medico", "examenes", "trabajo", "laboratorio", "vest_enfermeras", "hall"];
const LISTA_A = [["Atención", ["sala", "c1", "c2", "c3", "c4", "c5", "examenes_esp", "natalia", "administracion"]],
  ["Área quirúrgica", ["pre_op", "q1", "q2", "post_op", "limpio", "insumos", "vest_medico"]],
  ["Óptica", ["optica", "examenes", "trabajo"]],
  ["Apoyo", ["estar", "laboratorio", "archivo", "util", "vest_enfermeras", "limpieza", "hall"]]];
// etiquetas de cada parada del paseo
const MARCA = { plano: ["Dibujado en el plano", "plano"], mixto: ["Parte del plano, parte ilustrativa", "mixto"], mio: ["Muebles ilustrativos", "mio"] };
const FUERZA = { guia: ["Guía o norma", "guia"], estudio: ["Estudio publicado", "estudio"], criterio: ["Criterio propio", "mio"] };

const render = new THREE.WebGLRenderer({ canvas: lienzo, antialias: true, powerPreference: "high-performance" });
render.setPixelRatio(Math.min(devicePixelRatio, LIVIANO ? 1.5 : 2));
render.toneMapping = THREE.AgXToneMapping;
render.toneMappingExposure = 1.0;
const escena = new THREE.Scene();
const camara = new THREE.PerspectiveCamera(38, 1, 0.08, 600);
const orbita = new OrbitControls(camara, lienzo);
orbita.enableDamping = true; orbita.dampingFactor = 0.08;
orbita.maxPolarAngle = 1.38; orbita.minDistance = 9; orbita.maxDistance = 95;
orbita.target.set(20.7, 0.8, 8.4);
const VISTA_MAQUETA = new THREE.Vector3(20.7, 35, 44.5);
camara.position.copy(VISTA_MAQUETA);

const estado = { modo: "maqueta", ambiente: -2, anim: null, paseo: null, panel: false, cargando: false };
let v = null;                         // la planta que se está viendo: { id, cfg, datos, tabla, raiz, grupos, tapas, mapa, plano, paseo, … }
let caminante = null, entorno = null, espejo = null;
const texBase = new Map();            // texturas de materiales (se comparten entre las dos plantas)
const etiquetas = [];

// ── cielo y sombra bajo la maqueta
function fondo() {
  const c = document.createElement("canvas"); c.width = 4; c.height = 512;
  const g = c.getContext("2d"), grad = g.createLinearGradient(0, 0, 0, 512);
  [[0, "#7fb2e6"], [0.42, "#cfe4f6"], [0.5, "#eef3f6"], [0.52, "#e3e4e1"], [1, "#c9cdd0"]].forEach(([p, col]) => grad.addColorStop(p, col));
  g.fillStyle = grad; g.fillRect(0, 0, 4, 512);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const cielo = new THREE.Mesh(new THREE.SphereGeometry(450, 24, 16), new THREE.MeshBasicMaterial({ map: t, side: THREE.BackSide, toneMapped: false, depthWrite: false }));
  cielo.position.set(20, 0, 10);
  escena.add(cielo);
  const s = document.createElement("canvas"); s.width = s.height = 256;
  const gs = s.getContext("2d"), gr = gs.createRadialGradient(128, 128, 30, 128, 128, 128);
  gr.addColorStop(0, "rgba(20,30,40,.5)"); gr.addColorStop(0.55, "rgba(20,30,40,.26)"); gr.addColorStop(1, "rgba(20,30,40,0)");
  gs.fillStyle = gr; gs.fillRect(0, 0, 256, 256);
  const sombra = new THREE.Mesh(new THREE.PlaneGeometry(74, 48), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(s), transparent: true, depthWrite: false, toneMapped: false }));
  sombra.rotation.x = -Math.PI / 2; sombra.position.set(20.7, -0.06, 10.4);
  escena.add(sombra);
  // piso pulido: un espejo debajo del piso (el piso es apenas translúcido y deja ver el reflejo), solo bajo la huella del edificio
  if (!LIVIANO) {                                  // en celulares se omite: dibuja la escena dos veces
    const huella = new THREE.Shape([[0, 0], [38.7, 0], [38.7, 2.13], [41.52, 2.13], [41.52, 18.72], [38.7, 18.72], [38.7, 20.85], [0, 20.85]]
      .map(([x, y]) => new THREE.Vector2(x, -y)));
    espejo = new Reflector(new THREE.ShapeGeometry(huella), { textureWidth: 1024, textureHeight: 1024, color: 0x9a9a9a, clipBias: 0.003 });
    espejo.rotation.x = -Math.PI / 2; espejo.position.y = -0.004;
    escena.add(espejo);
  }
}

// ── materiales: la tabla viene de Blender (materiales.json); la luz ya está horneada
function materiales(tabla, k, kLm, lm, basura) {
  const cache = new Map();
  const mapa2 = (spec) => {
    if (!spec.mapa) return null;
    const t = texBase.get(spec.mapa).clone();
    t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; t.anisotropy = 8;
    if (!spec.unico) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / spec.tam, 1 / spec.tam); }
    t.needsUpdate = true;
    basura.push(t);
    return t;
  };
  return (nombre, grupo) => {
    const clave = nombre + "|" + grupo;
    if (cache.has(clave)) return cache.get(clave);
    const spec = tabla[nombre] || { color: "#ff00ff" };
    const color = new THREE.Color(spec.color);
    let m;
    if (spec.alfa !== undefined && spec.alfa < 1) {
      m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: spec.alfa, depthWrite: false, side: THREE.DoubleSide });
    } else if (spec.emite) {
      m = new THREE.MeshBasicMaterial({ color: new THREE.Color(spec.emite[0]).multiplyScalar(spec.mapa ? 1.15 : 1.9), map: mapa2(spec) });
    } else if (spec.metal > 0.5) {
      m = new THREE.MeshStandardMaterial({ color, metalness: 1, roughness: spec.rug, envMap: entorno, envMapIntensity: 0.9 });
    } else if (spec.luz === false) {
      m = new THREE.MeshBasicMaterial({ color });
    } else if (CON_LUZ_TEXTURA.has(grupo)) {
      m = new THREE.MeshBasicMaterial({ color, map: mapa2(spec), lightMap: lm["lm_" + grupo], lightMapIntensity: Math.PI / kLm });
      if (grupo === "pisos" && !LIVIANO) { m.transparent = true; m.opacity = spec.rug < 0.3 ? 0.87 : 0.95; }
    } else {
      m = new THREE.MeshBasicMaterial({ color: color.multiplyScalar(1 / k), map: mapa2(spec), vertexColors: true });
    }
    m.name = nombre;
    cache.set(clave, m); basura.push(m);
    return m;
  };
}

const cargadorTex = new THREE.TextureLoader();
const cargarTextura = (url) => new Promise((ok, mal) => cargadorTex.load(url, ok, undefined, () => mal(new Error("no se pudo leer " + url))));
const leerJson = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(`no se pudo leer ${url} (${r.status})`); return r.json(); });

async function cargarModelo(url, alAvanzar) {
  const cargador = new GLTFLoader();
  if (!url.endsWith(".txt")) {
    return new Promise((ok, mal) => cargador.load(url, ok, (e) => alAvanzar(e.total ? e.loaded / e.total : 0.5), mal));
  }
  const r = await fetch(url);
  if (!r.ok) throw new Error(`no se pudo leer ${url} (${r.status})`);
  const total = Number(r.headers.get("content-length")) || 0;
  const lector = r.body.getReader(), trozos = [];
  let leidos = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    trozos.push(value); leidos += value.length;
    alAvanzar(total ? leidos / total : 0.5);
  }
  const texto = new TextDecoder().decode(await new Blob(trozos).arrayBuffer()).trim();
  const bytes = Uint8Array.fromBase64 ? Uint8Array.fromBase64(texto) : base64ABytes(texto);
  return cargador.parseAsync(bytes.buffer, "");
}

function base64ABytes(t) {
  const bin = atob(t), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const avance = (p, texto) => { $("carga-pct").textContent = Math.round(p); if (texto) $("carga-texto").textContent = texto; };

// ── carga de una planta completa
async function cargarVersion(id) {
  const cfg = VERSIONES[id], dir = cfg.dir;
  avance(2, `Cargando «${cfg.nombre}»…`);
  const [tabla, datos, paseo, literatura] = await Promise.all([leerJson(`${dir}/materiales.json`), leerJson(`${dir}/planta.json`),
    leerJson(`${dir}/paseo.json`).catch(() => null), id === "b" ? leerJson(`${dir}/literatura.json`).catch(() => null) : null]);
  const basura = [], lm = {};
  const faltan = [...new Set(Object.values(tabla.materiales).map((m) => m.mapa).filter(Boolean))].filter((f) => !texBase.has(f));
  let hechas = 0;
  const total = faltan.length + 3;
  const paso = () => avance(8 + 40 * ++hechas / total, "Cargando texturas y luz…");
  await Promise.all([
    ...faltan.map((f) => cargarTextura("tex/" + f).then((t) => { texBase.set(f, t); paso(); })),
    ...["muros", "pisos", "techo"].map((n) => cargarTextura(`${dir}/lm_${n}.webp`).then((t) => {
      t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.channel = 1; t.generateMipmaps = false;
      t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
      lm["lm_" + n] = t; basura.push(t); paso();
    })),
  ]);
  const mat = materiales(tabla.materiales, tabla.k, tabla.k_lm || tabla.k, lm, basura);
  const gltf = await cargarModelo(`${dir}/${ARCHIVO_MODELO}`, (f) => avance(50 + 46 * Math.min(0.99, f), "Cargando el modelo…"));
  const grupos = {};
  for (const hijo of [...gltf.scene.children]) {
    const grupo = hijo.name.split(".")[0];
    grupos[grupo] = hijo;
    hijo.traverse((o) => {
      if (!o.isMesh) return;
      const anterior = o.material;
      o.material = mat(anterior.name, grupo);
      anterior.dispose();
      if (grupo === "vidrios") o.renderOrder = 3;
      if (grupo === "pisos") o.renderOrder = 1;
    });
  }
  // ductos cerrados del edificio: en la maqueta se tapan como el resto del núcleo (si no, se ven como huecos negros)
  const tapas = new THREE.Group();
  const matTapa = new THREE.MeshBasicMaterial({ color: new THREE.Color(tabla.materiales.corte.color) });
  basura.push(matTapa);
  for (const a of datos.ambientes.filter((x) => x.id === "nucleo_no")) {
    for (const r of a.rects) {
      const t = new THREE.Mesh(new THREE.PlaneGeometry(r[2] - r[0], r[3] - r[1]), matTapa);
      t.rotation.x = -Math.PI / 2; t.position.set((r[0] + r[2]) / 2, datos.alto - 0.001, (r[1] + r[3]) / 2);
      tapas.add(t);
    }
  }
  if (paseo) prepararPaseo(paseo);
  return { id, cfg, datos, tabla, paseo, literatura, raiz: gltf.scene, grupos, tapas, basura, mapa: new Mapa(datos) };
}

function descartar(ver) {
  escena.remove(ver.raiz); escena.remove(ver.tapas);
  for (const raiz of [ver.raiz, ver.tapas]) raiz.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
  for (const b of ver.basura) b.dispose();
}

function marcarPestana(id) {                     // (la versión de una sola planta no tiene pestañas)
  for (const k of ["a", "b"]) {
    const boton = $("ver-" + k);
    if (boton) { boton.classList.toggle("activo", k === id); boton.setAttribute("aria-selected", k === id); }
  }
}

// cambia de planta sin recargar la página
async function ponerVersion(id) {
  if (estado.cargando || (v && v.id === id)) return;
  estado.cargando = true;
  cerrarPaneles();
  marcarPestana(id);
  $("carga").classList.remove("listo");
  try {
    const nueva = await cargarVersion(id);
    if (v) descartar(v);
    v = nueva;
    escena.add(v.raiz); escena.add(v.tapas);
    if (!caminante) caminante = new Caminante(camara, lienzo, v.mapa); else caminante.mapa = v.mapa;
    caminante.ponerEn(8, 10.45, 0);
    v.plano = new Plano($("plano"), v.datos);
    vestirInterfaz();
    estado.modo = "maqueta";
    ponerModo("maqueta", true);
    avance(100, "Listo");
    $("carga").classList.add("listo");
  } catch (e) {
    console.error(e);
    $("carga-texto").textContent = "No se pudo cargar: " + e.message;
    if (v) {                                           // se queda en la planta que ya estaba
      marcarPestana(v.id);
      setTimeout(() => $("carga").classList.add("listo"), 2600);
    }
  }
  estado.cargando = false;
}

// ── interfaz que depende de la planta
function vestirInterfaz() {
  const ui = v.datos.ui || {};
  $("plano-titulo").textContent = ui.titulo || v.cfg.titulo;
  $("plano-sub").textContent = ui.subtitulo || v.cfg.sub;
  $("firma").textContent = ui.firma || v.cfg.firma;
  if ($("btn-fuentes")) $("btn-fuentes").hidden = !v.literatura;
  $("gal-rotulo").textContent = SOLO ? "Renders del modelo" : "Renders del modelo · " + v.cfg.nombre;
  crearEtiquetas();
  listaDeAmbientes();
  armarGaleria();
}

function crearEtiquetas() {
  const capa = $("etiquetas");
  capa.replaceChildren(); etiquetas.length = 0;
  for (const id of (v.datos.ui && v.datos.ui.etiquetas) || ETIQUETAS_A) {
    const a = v.datos.ambientes.find((x) => x.id === id);
    if (!a) continue;
    const r = a.rects[0], b = document.createElement("button");
    b.className = "etiqueta"; b.textContent = a.nombre.replace(" · JMV", "");
    b.onclick = () => irA((r[0] + r[2]) / 2, (r[1] + r[3]) / 2);
    capa.append(b);
    etiquetas.push({ el: b, p: new THREE.Vector3((r[0] + r[2]) / 2, 2.9, (r[1] + r[3]) / 2) });
  }
}

const _v = new THREE.Vector3();
function moverEtiquetas(visibles) {
  $("etiquetas").classList.toggle("oculto", !visibles);
  if (!visibles) return;
  const w = lienzo.clientWidth, h = lienzo.clientHeight;
  for (const e of etiquetas) {
    _v.copy(e.p).project(camara);
    const fuera = _v.z > 1 || Math.abs(_v.x) > 1.05 || Math.abs(_v.y) > 1.05;
    e.el.style.display = fuera ? "none" : "";
    if (!fuera) e.el.style.transform = `translate(-50%, -50%) translate(${((_v.x + 1) / 2 * w).toFixed(1)}px, ${((1 - _v.y) / 2 * h).toFixed(1)}px)`;
  }
}

function listaDeAmbientes() {
  const cont = $("lista");
  cont.replaceChildren(); cont.hidden = true;
  for (const [titulo, ids] of (v.datos.ui && v.datos.ui.lista) || LISTA_A) {
    const h = document.createElement("h2"); h.textContent = titulo; cont.append(h);
    for (const id of ids) {
      const a = v.datos.ambientes.find((x) => x.id === id);
      if (!a) continue;
      const b = document.createElement("button");
      const nombre = document.createElement("span"), medidas = document.createElement("small");
      nombre.textContent = a.nombre; medidas.textContent = a.medidas.replace(" m", "");
      b.append(nombre, medidas);
      b.onclick = () => { const r = a.rects[0]; irA((r[0] + r[2]) / 2, (r[1] + r[3]) / 2); cont.hidden = true; };
      cont.append(b);
    }
  }
}

function area(a) { return a.rects.reduce((s, r) => s + (r[2] - r[0]) * (r[3] - r[1]), 0); }
function medidasDe(a) { return [a.medidas, `≈ ${area(a).toFixed(1).replace(".", ",")} m²`].filter(Boolean).join(" · "); }

function ficha(i) {
  if (i === estado.ambiente) return;
  if (i < 0 && estado.modo !== "maqueta" && estado.ambiente >= 0) return;      // bajo el marco de una puerta: se queda el último
  estado.ambiente = i;
  const a = i >= 0 ? v.datos.ambientes[i] : null;
  if (!a || estado.modo === "maqueta") {
    $("ficha-zona").textContent = "Vista general"; $("ficha-nombre").textContent = "Centro Oftálmico";
    $("ficha-medidas").textContent = v.cfg.resumen;
    return;
  }
  $("ficha-zona").textContent = ZONAS[a.zona] || "";
  $("ficha-nombre").textContent = a.nombre || "Zona del edificio";
  $("ficha-medidas").textContent = medidasDe(a);
}

const AYUDA = TACTIL ? {
  maqueta: "Arrastra para girar · pellizca para acercar · toca un nombre o el plano para entrar",
  caminar: "Arrastra para mirar · toca el piso para caminar · toca el plano para ir a otro ambiente",
  paseo: "El paseo va solo, de ambiente en ambiente · usa ‹ › para saltar · toca Caminar para seguir por tu cuenta",
} : {
  maqueta: "Arrastra para girar · rueda para acercar · toca un ambiente del plano para entrar",
  caminar: "<kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> o flechas para caminar · arrastra para mirar · toca el piso para ir · <kbd>M</kbd> maqueta",
  paseo: "El paseo va solo, de ambiente en ambiente · <kbd>←</kbd> <kbd>→</kbd> saltan de parada · <kbd>espacio</kbd> pausa",
};

function ponerModo(modo, inmediato) {
  if (!v) return;
  if (modo === "paseo" && !v.paseo) modo = "caminar";
  const antes = estado.modo;
  estado.modo = modo; estado.paseo = null;
  for (const m of ["maqueta", "caminar", "paseo"]) $("modo-" + m).classList.toggle("activo", m === modo);
  $("ayuda").innerHTML = AYUDA[modo];
  $("ayuda").classList.add("mostrar");                        // en el celular la ayuda aparece unos segundos
  clearTimeout(ponerModo.t);
  ponerModo.t = setTimeout(() => $("ayuda").classList.remove("mostrar"), 6500);
  orbita.enabled = false; caminante.activo = false;
  estado.ambiente = -2;
  $("paseo-caja").hidden = modo !== "paseo";
  $("ficha-botones").hidden = modo === "paseo";
  $("ficha").classList.toggle("en-paseo", modo === "paseo");
  if (modo === "paseo") $("lista").hidden = true;
  if (modo === "maqueta") {
    // en pantallas angostas (teléfono de pie) la cámara se aleja para que entre toda la planta
    const lejos = Math.max(1, 1.45 / (lienzo.clientWidth / lienzo.clientHeight));
    const vista = orbita.target.clone().add(VISTA_MAQUETA.clone().sub(orbita.target).multiplyScalar(lejos));
    orbita.maxDistance = 95 * lejos;
    const fin = () => { orbita.enabled = true; camara.fov = 38; camara.updateProjectionMatrix(); };
    if (inmediato || antes === "maqueta") { camara.position.copy(vista); camara.lookAt(orbita.target); estado.anim = null; fin(); }
    else volar(vista, orbita.target, 38, 1.5, fin);
    return;
  }
  if (modo === "paseo") {
    const c = v.paseo.paradas[0].camino;
    caminante.ponerEn(c[0][0], c[0][1], Math.atan2(c[1][1] - c[0][1], c[1][0] - c[0][0]));
    mostrarParada(0);
  }
  const p = caminante.pos, c = Math.cos(caminante.rumbo), s = Math.sin(caminante.rumbo);
  const ojo = new THREE.Vector3(p.x, caminante.altura, p.y);
  const listo = () => {
    caminante.cabeceo = -0.03; caminante.aplicar();
    if (modo === "caminar") caminante.activo = true;
    else estado.paseo = { i: 0, fase: "caminar", s: 0, t: 0, pausa: false, r0: 0, giro: 0 };
  };
  if (antes === "maqueta") volar(ojo, new THREE.Vector3(p.x + c, caminante.altura - 0.03, p.y + s), 72, 1.7, listo);
  else { camara.fov = 72; camara.updateProjectionMatrix(); listo(); }
}

// vuelo suave de la cámara entre dos vistas
function volar(pos, mira, fov, seg, alTerminar) {
  const q0 = camara.quaternion.clone(), p0 = camara.position.clone(), f0 = camara.fov;
  const aux = new THREE.PerspectiveCamera(); aux.position.copy(pos); aux.lookAt(mira);
  estado.anim = { t: 0, seg: QUIETO ? 0.01 : seg, p0, q0, f0, p1: pos.clone(), q1: aux.quaternion.clone(), f1: fov, alTerminar };
}

function irA(x, y) {
  if (!v || estado.cargando) return;
  const libre = v.mapa.cercaLibre(x, y);
  if (!libre) return;
  const actual = caminante.pos.clone();
  if (estado.modo === "caminar" && actual.distanceTo(new THREE.Vector2(...libre)) < 14 && v.mapa.ambienteEn(actual.x, actual.y) === v.mapa.ambienteEn(...libre)) {
    caminante.destino = new THREE.Vector2(...libre);
    return;
  }
  // entrar mirando hacia el centro del ambiente
  const i = v.mapa.ambienteEn(...libre);
  let rumbo = caminante.rumbo;
  if (i >= 0) {
    const r = v.datos.ambientes[i].rects[0], cx = (r[0] + r[2]) / 2, cy = (r[1] + r[3]) / 2;
    const largo = r[2] - r[0] > r[3] - r[1];
    const p = v.mapa.cercaLibre(largo ? r[0] + 0.7 : cx, largo ? cy : r[1] + 0.7);
    if (p && Math.hypot(libre[0] - cx, libre[1] - cy) < 1.2) { libre[0] = p[0]; libre[1] = p[1]; }
    rumbo = Math.atan2(cy - libre[1], cx - libre[0]);
    if (Math.hypot(cx - libre[0], cy - libre[1]) < 0.3) rumbo = caminante.rumbo;
  }
  caminante.ponerEn(libre[0], libre[1], rumbo);
  const antes = estado.modo;
  estado.modo = antes === "maqueta" ? "maqueta" : "otro";
  ponerModo("caminar");
  if (antes !== "maqueta") fundido();                  // salto corto entre ambientes: fundido rápido
}

function fundido() { lienzo.animate([{ opacity: 0.25 }, { opacity: 1 }], { duration: 380, easing: "ease-out" }); }

// ── paseo guiado: de parada en parada por el camino que calculó herramientas/paseo.py
function prepararPaseo(p) {
  p.linea = [];
  for (const s of p.paradas) {
    s.acum = [0];
    for (let k = 1; k < s.camino.length; k++) s.acum.push(s.acum[k - 1] + Math.hypot(s.camino[k][0] - s.camino[k - 1][0], s.camino[k][1] - s.camino[k - 1][1]));
    s.largo = s.acum[s.acum.length - 1];
    p.linea.push(...s.camino);
  }
}

function puntoEn(s, d) {                        // punto del camino a d metros de su inicio
  const c = s.camino, ac = s.acum;
  if (d <= 0) return c[0];
  if (d >= s.largo) return c[c.length - 1];
  let k = 1;
  while (ac[k] < d) k++;
  const t = (d - ac[k - 1]) / (ac[k] - ac[k - 1] || 1);
  return [c[k - 1][0] + (c[k][0] - c[k - 1][0]) * t, c[k - 1][1] + (c[k][1] - c[k - 1][1]) * t];
}

const difAngulo = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
const suave = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

function mostrarParada(i) {
  const P = v.paseo.paradas, p = P[i], a = v.datos.ambientes[p.i];
  $("ficha-zona").textContent = `Paseo · parada ${i + 1} de ${P.length}`;
  $("ficha-nombre").textContent = p.nombre.replace(" · JMV", "");
  $("ficha-medidas").textContent = medidasDe(a);
  $("paseo-texto").textContent = p.texto;
  const marcas = $("paseo-marcas");
  marcas.replaceChildren();
  const chip = (texto, clase) => { const s = document.createElement("span"); s.className = "chip chip-" + clase; s.textContent = texto; marcas.append(s); };
  if (p.marca && MARCA[p.marca]) chip(...MARCA[p.marca]);
  if (p.fuerza && FUERZA[p.fuerza]) chip(...FUERZA[p.fuerza]);
  for (const f of p.fuente || []) {
    const dato = v.literatura && v.literatura.fuentes[f];
    if (dato) chip(dato.corta, "fuente");
  }
  $("paseo-avance").style.width = `${((i + 1) / P.length * 100).toFixed(1)}%`;
  $("paseo-cuenta").textContent = `${i + 1} / ${P.length}`;
}

function empezarGiro(ps, p) {
  ps.fase = "mirar"; ps.t = 0; ps.r0 = caminante.rumbo;
  ps.giro = p.mira ? difAngulo(Math.atan2(p.mira[1] - p.y, p.mira[0] - p.x), ps.r0) + (p.giro || 0) : p.giro;
}

function irParada(i) {                          // salto directo a una parada (botones ‹ ›)
  const ps = estado.paseo, P = v.paseo.paradas;
  if (!ps) return;
  if (i >= P.length) { ponerModo("caminar"); return; }
  ps.i = Math.max(0, i);
  const p = P[ps.i];
  caminante.ponerEn(p.x, p.y, p.llegada || 0);
  mostrarParada(ps.i);
  empezarGiro(ps, p);
  fundido();
}

function pausarPaseo(pausa) {
  const ps = estado.paseo;
  if (!ps) return;
  ps.pausa = pausa === undefined ? !ps.pausa : pausa;
  $("paseo-pausa").textContent = ps.pausa ? "Seguir" : "Pausa";
}

function avanzarPaseo(dt) {
  const ps = estado.paseo, P = v.paseo.paradas, p = P[ps.i];
  if (!ps.pausa) {
    if (ps.fase === "caminar") {
      const vel = Math.min(2.6, Math.max(1.5, 1.2 + p.largo / 12));
      const freno = Math.min(1, 0.3 + ps.s / 0.9, 0.3 + (p.largo - ps.s) / 0.9);       // arranca y llega despacio
      ps.s = Math.min(p.largo, ps.s + dt * vel * freno);
      const [x, y] = puntoEn(p, ps.s), [hx, hy] = puntoEn(p, ps.s + 1.3);
      caminante.pos.set(x, y);
      if (Math.hypot(hx - x, hy - y) > 0.08) {             // mira un poco más adelante del camino para doblar con suavidad
        caminante.rumbo += difAngulo(Math.atan2(hy - y, hx - x), caminante.rumbo) * (1 - Math.exp(-dt * 3.4));
      }
      if (ps.s >= p.largo - 1e-3) empezarGiro(ps, p);
    } else {
      ps.t += dt / p.seg;
      // con un punto que mirar: gira hacia él y se queda; si no, da la vuelta completa (o lo que pida la parada)
      caminante.rumbo = ps.r0 + ps.giro * suave(Math.min(1, ps.t / (p.mira ? 0.4 : 1)));
      if (ps.t >= 1) {
        if (ps.i + 1 >= P.length) { ponerModo("caminar"); return; }
        ps.i++; ps.fase = "caminar"; ps.s = 0;
        mostrarParada(ps.i);
      }
    }
  }
  caminante.aplicar();
}

let antes = performance.now();
function cuadro(ahora) {
  const dt = Math.min(0.05, (ahora - antes) / 1000); antes = ahora;
  requestAnimationFrame(cuadro);
  if (!v || estado.panel) return;                        // con la galería o las fuentes abiertas no se dibuja el 3D
  const w = lienzo.clientWidth, h = lienzo.clientHeight;
  if (lienzo.width !== Math.floor(w * render.getPixelRatio()) || lienzo.height !== Math.floor(h * render.getPixelRatio())) {
    render.setSize(w, h, false); camara.aspect = w / h; camara.updateProjectionMatrix();
  }
  const an = estado.anim;
  if (an) {
    an.t = Math.min(1, an.t + dt / an.seg);
    const e = an.t < 0.5 ? 4 * an.t ** 3 : 1 - (-2 * an.t + 2) ** 3 / 2;
    camara.position.lerpVectors(an.p0, an.p1, e);
    camara.quaternion.slerpQuaternions(an.q0, an.q1, e);
    camara.fov = an.f0 + (an.f1 - an.f0) * e; camara.updateProjectionMatrix();
    if (an.t >= 1) { estado.anim = null; an.alTerminar && an.alTerminar(); }
  } else if (estado.modo === "maqueta") orbita.update();
  else if (estado.modo === "caminar") caminante.actualizar(dt);
  else if (estado.paseo) avanzarPaseo(dt);

  const adentro = camara.position.y < 2.66;
  for (const n of SOLO_ADENTRO) if (v.grupos[n]) v.grupos[n].visible = adentro;
  v.tapas.visible = !adentro;

  // plano: punto naranja y ambiente resaltado
  let pos, amb = -1;
  if (estado.modo === "maqueta" || an) {
    pos = { x: orbita.target.x, y: orbita.target.z, rumbo: null };
    if (an) pos = { x: camara.position.x, y: camara.position.z, rumbo: null };
  } else {
    pos = { x: caminante.pos.x, y: caminante.pos.y, rumbo: caminante.rumbo };
    amb = v.mapa.ambienteEn(pos.x, pos.y);
  }
  if (pos.x < 0 || pos.x > 41.5 || pos.y < 0 || pos.y > 20.9) pos = null;
  const ps = estado.modo === "paseo" ? estado.paseo : null;
  if (estado.modo !== "paseo") ficha(amb);
  moverEtiquetas(estado.modo === "maqueta" && !an);
  if (estado.modo === "paseo") v.plano.dibujar(amb, pos, v.paseo.linea, v.paseo.paradas, ps ? ps.i : 0);
  else v.plano.dibujar(amb, pos, null);
  render.render(escena, camara);
}

$("modo-maqueta").onclick = () => ponerModo("maqueta");
$("modo-caminar").onclick = () => ponerModo("caminar");
$("modo-paseo").onclick = () => ponerModo("paseo");
let versionInicial = () => SOLO || "a";
$("plano-tam").onclick = () => $("plano-tarjeta").classList.toggle("grande");
$("plano").addEventListener("click", (e) => { if (v && v.plano) irA(...v.plano.aMetros(e)); });
$("btn-lista").onclick = () => { $("lista").hidden = !$("lista").hidden; };
$("paseo-ant").onclick = () => estado.paseo && irParada(estado.paseo.i - 1);
$("paseo-sig").onclick = () => estado.paseo && irParada(estado.paseo.i + (estado.paseo.fase === "caminar" ? 0 : 1));
$("paseo-pausa").onclick = () => pausarPaseo();

// ── galería de imágenes renderizadas (una lista por planta)
const galeria = { actual: 0 };
function verImagen(i) {
  const lista = v.cfg.imagenes;
  galeria.actual = (i + lista.length) % lista.length;
  const [archivo, nombre] = lista[galeria.actual];
  $("gal-img").src = `${v.cfg.img}/${archivo}.jpg`; $("gal-img").alt = nombre;
  $("gal-titulo").textContent = `${nombre} · ${galeria.actual + 1} de ${lista.length}`;
  $("gal-visor").hidden = false;
}
function armarGaleria() {
  const grilla = $("gal-grilla");
  grilla.replaceChildren();
  v.cfg.imagenes.forEach(([archivo, nombre], i) => {
    const b = document.createElement("button"), im = document.createElement("img"), s = document.createElement("span");
    b.className = "gal-mini";
    im.src = `${v.cfg.img}/min/${archivo}.jpg`; im.alt = ""; im.loading = "lazy"; im.width = 520; im.height = 325;
    s.textContent = nombre;
    b.append(im, s);
    b.onclick = () => verImagen(i);
    grilla.append(b);
  });
}
function cerrarPaneles() {
  $("galeria").hidden = true; $("gal-visor").hidden = true; $("lista").hidden = true;
  if ($("fuentes")) $("fuentes").hidden = true;
  estado.panel = false;
}
$("btn-imagenes").onclick = () => { $("galeria").hidden = false; estado.panel = true; $("lista").hidden = true; $("gal-cerrar").focus(); };
$("gal-cerrar").onclick = cerrarPaneles;
$("gal-volver").onclick = () => { $("gal-visor").hidden = true; };
$("gal-ant").onclick = () => verImagen(galeria.actual - 1);
$("gal-sig").onclick = () => verImagen(galeria.actual + 1);


// teclas: con un panel abierto son del panel (no mueven al caminante)
addEventListener("keydown", (e) => {
  if (!estado.panel) return;
  e.stopImmediatePropagation();
  const visor = $("gal-visor");
  if (e.key === "Escape") { if (!visor.hidden) visor.hidden = true; else cerrarPaneles(); }
  else if (!visor.hidden && e.key === "ArrowRight") verImagen(galeria.actual + 1);
  else if (!visor.hidden && e.key === "ArrowLeft") verImagen(galeria.actual - 1);
}, true);
addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLButtonElement && e.code === "Space") return;       // el espacio sobre un botón lo pulsa
  if (e.code === "KeyM") ponerModo("maqueta");
  if (e.code === "KeyC") ponerModo("caminar");
  if (e.code === "KeyP") ponerModo("paseo");
  if (estado.modo === "paseo" && estado.paseo) {
    if (e.code === "ArrowRight") $("paseo-sig").click();
    if (e.code === "ArrowLeft") $("paseo-ant").click();
    if (e.code === "Space") { e.preventDefault(); pausarPaseo(); }
  }
});

async function iniciar() {
  fondo();
  entorno = new THREE.PMREMGenerator(render).fromScene(new RoomEnvironment(), 0.04).texture;
  requestAnimationFrame(cuadro);
  if (SOLO) document.documentElement.classList.add("una-version");
  await ponerVersion(versionInicial());
  window.__centro = { camara, estado, ponerModo, ponerVersion, irA, irParada, render, escena, orbita,
    get caminante() { return caminante; }, get version() { return v; } };
}

iniciar().catch((e) => {
  console.error(e);
  $("carga-texto").textContent = "No se pudo cargar el modelo: " + e.message;
});
