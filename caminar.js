// Caminar por dentro: mapa de choques hecho del plano y control en primera persona.
import * as THREE from "three";

const RES = 0.05;                 // 5 cm por celda
const HUELLA = [[0.3, 0.25, 38.3, 20.6], [38.3, 2.3, 41.35, 18.55]];

export class Mapa {
  constructor(d) {
    this.d = d;
    this.w = Math.ceil(d.limites[2] / RES) + 2;
    this.h = Math.ceil(d.limites[3] / RES) + 2;
    this.solido = new Uint8Array(this.w * this.h).fill(1);
    for (const r of HUELLA) this.llenar(r, 0);
    for (const m of d.muros) this.llenar(m, 1);
    for (const m of d.columnas.concat(d.fachadas, d.mamparas)) this.llenar(m, 1);
    for (const v of d.vanos.concat(d.pasos)) this.llenar(v, 0);
    for (const p of d.puertas) {          // las puertas cerradas no se atraviesan
      if (p.tipo !== "cerrada") continue;
      this.llenar(p.eje === "H" ? [p.a, p.c - 0.25, p.b, p.c + 0.25] : [p.c - 0.25, p.a, p.c + 0.25, p.b], 1);
    }
    // muebles grandes: no se camina a través de ellos
    const grandes = new Set(["recepcion", "mueble_bajo", "mueble_alto", "librero", "mostrador_l", "vitrina_optica", "cocineta", "refrigerador",
      "lockers", "cajonera", "estanteria", "meson_lab", "banco_trabajo", "lavabo_triple", "lavabo_doble", "lavamanos_qx", "camilla", "mesa_qx",
      "escritorio", "mesa_comedor", "mesa_optica", "banca", "sofa", "mesa_acero"]);
    for (const m of d.muebles) {
      if (!grandes.has(m.tipo)) continue;
      let [w, f] = d.huellas[m.tipo] || [0.5, 0.5];
      w = m.tipo === "banca" ? w * (m.n || 1) : (m.largo || w);
      f = m.fondo || f;
      if (m.mira === "E" || m.mira === "O") [w, f] = [f, w];
      this.llenar([m.x - w / 2 + 0.06, m.y - f / 2 + 0.06, m.x + w / 2 - 0.06, m.y + f / 2 - 0.06], 1);
    }
  }

  llenar(r, v) {
    const x0 = Math.max(0, Math.floor(r[0] / RES)), x1 = Math.min(this.w - 1, Math.ceil(r[2] / RES));
    const y0 = Math.max(0, Math.floor(r[1] / RES)), y1 = Math.min(this.h - 1, Math.ceil(r[3] / RES));
    for (let y = y0; y < y1; y++) this.solido.fill(v, y * this.w + x0, y * this.w + x1);
  }

  ocupado(x, y) {
    const i = Math.floor(x / RES), j = Math.floor(y / RES);
    return i < 0 || j < 0 || i >= this.w || j >= this.h || this.solido[j * this.w + i] === 1;
  }

  // ¿cabe una persona (radio r) parada en (x, y)?
  libre(x, y, r = 0.2) {
    if (this.ocupado(x, y)) return false;
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4;
      if (this.ocupado(x + Math.cos(a) * r, y + Math.sin(a) * r)) return false;
    }
    return true;
  }

  ambienteEn(x, y) {
    const amb = this.d.ambientes;
    for (let i = 0; i < amb.length; i++)
      for (const r of amb[i].rects) if (x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3]) return i;
    return -1;
  }

  // punto libre más cercano (para cuando se toca un muro o un mueble en el plano)
  cercaLibre(x, y) {
    if (this.libre(x, y)) return [x, y];
    for (let d = 0.15; d < 2.5; d += 0.15)
      for (let k = 0; k < 16; k++) {
        const a = k * Math.PI / 8, px = x + Math.cos(a) * d, py = y + Math.sin(a) * d;
        if (this.libre(px, py)) return [px, py];
      }
    return null;
  }
}

export class Caminante {
  constructor(camara, dom, mapa) {
    this.camara = camara; this.dom = dom; this.mapa = mapa;
    this.pos = new THREE.Vector2(8, 10.45);      // x, y del plano
    this.rumbo = 0;                               // 0 = mira al este; crece hacia el sur
    this.cabeceo = -0.03;
    this.altura = 1.55;
    this.teclas = new Set();
    this.destino = null;
    this.activo = false;
    this.vel = new THREE.Vector2();
    this.rayo = new THREE.Raycaster();
    this.piso = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    let abajo = null;
    dom.addEventListener("pointerdown", (e) => {
      if (!this.activo) return;
      abajo = { x: e.clientX, y: e.clientY, t: performance.now(), movido: 0 };
      this.destino = null;
      dom.setPointerCapture(e.pointerId); dom.classList.add("arrastrando");
    });
    dom.addEventListener("pointermove", (e) => {
      if (!this.activo || !abajo) return;
      const dx = e.clientX - abajo.x, dy = e.clientY - abajo.y;      // (movementX no existe con el dedo)
      abajo.x = e.clientX; abajo.y = e.clientY;
      abajo.movido += Math.abs(dx) + Math.abs(dy);
      this.rumbo -= dx * 0.0034; this.cabeceo = Math.max(-1.1, Math.min(1.1, this.cabeceo + dy * 0.003));
    });
    dom.addEventListener("pointerup", (e) => {
      dom.classList.remove("arrastrando");
      if (!this.activo || !abajo) return;
      const toque = abajo.movido < 6 && performance.now() - abajo.t < 400;
      abajo = null;
      if (toque) this.irAlToque(e);
    });
    addEventListener("keydown", (e) => { if (this.activo) { this.teclas.add(e.code); if (e.code.startsWith("Arrow")) e.preventDefault(); } });
    addEventListener("keyup", (e) => this.teclas.delete(e.code));
    addEventListener("blur", () => this.teclas.clear());
  }

  irAlToque(e) {
    const r = this.dom.getBoundingClientRect();
    const p = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.rayo.setFromCamera(p, this.camara);
    const punto = new THREE.Vector3();
    if (!this.rayo.ray.intersectPlane(this.piso, punto)) return;
    if (punto.distanceTo(this.camara.position) > 25) return;
    const libre = this.mapa.cercaLibre(punto.x, punto.z);
    if (libre) this.destino = new THREE.Vector2(libre[0], libre[1]);
  }

  ponerEn(x, y, rumbo) {
    this.pos.set(x, y);
    if (rumbo !== undefined) this.rumbo = rumbo;
    this.destino = null; this.vel.set(0, 0);
  }

  mover(dx, dy) {
    const { pos, mapa } = this;
    if (mapa.libre(pos.x + dx, pos.y + dy)) { pos.x += dx; pos.y += dy; return true; }
    if (dx && mapa.libre(pos.x + dx, pos.y)) { pos.x += dx; return true; }
    if (dy && mapa.libre(pos.x, pos.y + dy)) { pos.y += dy; return true; }
    return false;
  }

  actualizar(dt) {
    const t = this.teclas;
    const adelante = (t.has("KeyW") || t.has("ArrowUp") ? 1 : 0) - (t.has("KeyS") || t.has("ArrowDown") ? 1 : 0);
    const lado = (t.has("KeyD") ? 1 : 0) - (t.has("KeyA") ? 1 : 0);
    const giro = (t.has("ArrowRight") || t.has("KeyE") ? 1 : 0) - (t.has("ArrowLeft") || t.has("KeyQ") ? 1 : 0);
    this.rumbo += giro * dt * 1.9;
    const rapido = t.has("ShiftLeft") || t.has("ShiftRight") ? 1.9 : 1;
    const meta = new THREE.Vector2();
    if (adelante || lado) {
      this.destino = null;
      const c = Math.cos(this.rumbo), s = Math.sin(this.rumbo);
      meta.set(c * adelante - s * lado, s * adelante + c * lado).normalize().multiplyScalar(2.3 * rapido);
    } else if (this.destino) {
      const falta = this.destino.clone().sub(this.pos);
      const dist = falta.length();
      if (dist < 0.08) this.destino = null;
      else meta.copy(falta).multiplyScalar(Math.min(3.2, Math.max(0.6, dist * 2.2)) / dist);
    }
    this.vel.lerp(meta, 1 - Math.exp(-dt * 9));
    if (this.vel.lengthSq() > 1e-5) {
      const pudo = this.mover(this.vel.x * dt, this.vel.y * dt);
      if (!pudo && this.destino) this.destino = null;
    }
    this.aplicar();
  }

  aplicar() {
    const c = this.camara;
    c.position.set(this.pos.x, this.altura, this.pos.y);
    const cp = Math.cos(this.cabeceo);
    c.lookAt(this.pos.x + Math.cos(this.rumbo) * cp, this.altura + Math.sin(this.cabeceo), this.pos.y + Math.sin(this.rumbo) * cp);
  }
}
