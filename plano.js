// Plano 2D (estilo copia azul) dibujado desde planta.json: la misma fuente que el modelo 3D.

const ROTULOS = {
  sala: "SALA DE ESPERA", c1: "CONS. 1", c2: "CONS. 2", natalia: "NATALIA", c3: "CONS. 3", c4: "CONS. 4", c5: "CONS. 5",
  q1: "QUIRÓFANO 1", q2: "QUIRÓFANO 2", examenes_esp: "EXÁMENES ESP.", administracion: "ADMIN.", optica: "ÓPTICA",
  estar: "ESTAR MÉDICO", insumos: "INSUMOS", post_op: "POST OP.", pre_op: "PRE OP.", vest_medico: "VEST. MÉD.",
  examenes: "EXÁMENES", trabajo: "TRABAJO", hall: "HALL", laboratorio: "LAB.", util: "ÚTIL", limpio: "CORREDOR LIMPIO",
  vest_enfermeras: "VEST. ENF.", limpieza: "LIMP.",
};

export class Plano {
  constructor(lienzo, datos) {
    this.lienzo = lienzo;
    this.d = datos;
    this.g = lienzo.getContext("2d");
    const [, , ancho, alto] = datos.limites;
    this.margen = 14;
    this.esc = (lienzo.width - this.margen * 2) / ancho;
    lienzo.height = Math.round(alto * this.esc + this.margen * 2);
    this.base = this.dibujarBase();
  }

  // punto del plano (en metros) que corresponde a un toque
  aMetros(e) {
    const r = this.lienzo.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width * this.lienzo.width - this.margen) / this.esc,
      ((e.clientY - r.top) / r.height * this.lienzo.height - this.margen) / this.esc];
  }

  px(x, y) { return [this.margen + x * this.esc, this.margen + y * this.esc]; }

  rect(g, r) {
    const [a, b] = this.px(r[0], r[1]);
    g.rect(a, b, (r[2] - r[0]) * this.esc, (r[3] - r[1]) * this.esc);
  }

  dibujarBase() {
    const c = document.createElement("canvas");
    c.width = this.lienzo.width; c.height = this.lienzo.height;
    const g = c.getContext("2d");
    const d = this.d, e = this.esc;
    // cuadrícula de 1 m muy tenue
    g.strokeStyle = "rgba(255,255,255,.07)"; g.lineWidth = 1; g.beginPath();
    for (let x = 0; x <= d.limites[2]; x += 2) { const [a] = this.px(x, 0); g.moveTo(a, 0); g.lineTo(a, c.height); }
    for (let y = 0; y <= d.limites[3]; y += 2) { const [, b] = this.px(0, y); g.moveTo(0, b); g.lineTo(c.width, b); }
    g.stroke();
    // muebles (contorno fino)
    g.strokeStyle = "rgba(255,255,255,.42)"; g.lineWidth = 1;
    for (const m of d.muebles) {
      let [w, f] = d.huellas[m.tipo] || [0.5, 0.5];
      w = m.tipo === "banca" ? w * (m.n || 1) : (m.largo || w);
      f = m.fondo || f;
      if (m.mira === "E" || m.mira === "O") [w, f] = [f, w];
      const [a, b] = this.px(m.x - w / 2, m.y - f / 2);
      g.strokeRect(Math.round(a) + .5, Math.round(b) + .5, w * e, f * e);
    }
    // líneas guía pintadas en el piso (solo la planta que las trae)
    g.lineWidth = 2.2; g.lineJoin = "round";
    for (const ln of (d.decor && d.decor.lineas) || []) {
      g.strokeStyle = ln.color; g.beginPath();
      ln.puntos.forEach(([x, y], i) => { const [a, b] = this.px(x, y); i ? g.lineTo(a, b) : g.moveTo(a, b); });
      g.stroke();
    }
    // muros, columnas y fachadas
    g.fillStyle = "rgba(255,255,255,.95)";
    g.beginPath();
    for (const m of d.muros) if (m[4] !== "N") this.rect(g, m);
    for (const k of d.columnas) this.rect(g, k);
    g.fill();
    g.fillStyle = "rgba(255,255,255,.5)";
    g.beginPath();
    for (const m of d.muros) if (m[4] === "N") this.rect(g, m);
    g.fill();
    // huecos de puerta: se borran del muro
    g.globalCompositeOperation = "destination-out";
    g.beginPath();
    for (const v of d.vanos.concat(d.pasos)) this.rect(g, v);
    g.fill();
    g.globalCompositeOperation = "source-over";
    // ventanales y mamparas (línea doble fina)
    g.strokeStyle = "rgba(190,225,255,.95)"; g.lineWidth = 1;
    for (const f of d.fachadas.concat(d.mamparas)) {
      const [a, b] = this.px(f[0], f[1]);
      g.strokeRect(Math.round(a) + .5, Math.round(b) + .5, Math.max(2, (f[2] - f[0]) * e), Math.max(2, (f[3] - f[1]) * e));
    }
    // puertas: hoja y arco
    g.strokeStyle = "rgba(255,255,255,.85)"; g.lineWidth = 1;
    const ang = { E: 0, S: Math.PI / 2, O: Math.PI, N: -Math.PI / 2 };
    for (const p of d.puertas) {
      if (p.tipo === "cerrada") continue;
      const hojas = p.bisagra === "ab" ? [["a", (p.b - p.a) / 2], ["b", (p.b - p.a) / 2]] : [[p.bisagra, p.b - p.a]];
      for (const [lado, largo] of hojas) {
        const u = lado === "a" ? p.a : p.b;
        const [x, y] = p.eje === "H" ? [u, p.c] : [p.c, u];
        const cerrada = p.eje === "H" ? (lado === "a" ? 0 : Math.PI) : (lado === "a" ? Math.PI / 2 : -Math.PI / 2);
        const abierta = ang[p.abre];
        const [cx, cy] = this.px(x, y);
        let dif = abierta - cerrada;
        while (dif > Math.PI) dif -= 2 * Math.PI;
        while (dif < -Math.PI) dif += 2 * Math.PI;
        g.beginPath();
        g.moveTo(cx, cy); g.lineTo(cx + Math.cos(abierta) * largo * e, cy + Math.sin(abierta) * largo * e);
        g.stroke();
        g.beginPath(); g.arc(cx, cy, largo * e, cerrada, abierta, dif < 0); g.stroke();
      }
    }
    // cortinas
    g.strokeStyle = "rgba(255,255,255,.7)"; g.setLineDash([2, 2]);
    for (const k of d.cortinas) { g.beginPath(); g.moveTo(...this.px(k[0], k[1])); g.lineTo(...this.px(k[2], k[3])); g.stroke(); }
    g.setLineDash([]);
    // rótulos
    g.fillStyle = "rgba(255,255,255,.96)"; g.textAlign = "center"; g.textBaseline = "middle";
    const rotulos = (d.ui && d.ui.rotulos) || ROTULOS;
    for (const a of d.ambientes) {
      const t = rotulos[a.id];
      if (!t) continue;
      const r = a.rects[0];
      const w = (r[2] - r[0]) * e;
      const tam = t.length < 3 ? 15 : Math.max(7, Math.min(11, w / (t.length * 0.62)));
      g.font = `700 ${tam}px Raleway, sans-serif`;
      const [x, y] = this.px((r[0] + r[2]) / 2, (r[1] + r[3]) / 2);
      g.fillText(t, x, y);
    }
    return c;
  }

  // ambiente = índice resaltado; pos = {x, y, rumbo} en metros y radianes (0 = este, π/2 = sur);
  // ruta y paradas del paseo (opcionales); hecha = cuántas paradas ya se visitaron
  dibujar(ambiente, pos, ruta, paradas, hecha) {
    const g = this.g, e = this.esc;
    g.clearRect(0, 0, this.lienzo.width, this.lienzo.height);
    if (ambiente >= 0) {
      g.fillStyle = "rgba(255,255,255,.2)";
      g.beginPath();
      for (const r of this.d.ambientes[ambiente].rects) this.rect(g, r);
      g.fill();
    }
    g.drawImage(this.base, 0, 0);
    if (ruta) {
      g.strokeStyle = "rgba(240,138,36,.75)"; g.lineWidth = 2; g.setLineDash([5, 4]); g.beginPath();
      ruta.forEach(([x, y], i) => { const [a, b] = this.px(x, y); i ? g.lineTo(a, b) : g.moveTo(a, b); });
      g.stroke(); g.setLineDash([]);
    }
    if (paradas) {
      paradas.forEach((p, i) => {
        const [a, b] = this.px(p.x, p.y);
        g.fillStyle = i < hecha ? "rgba(240,138,36,.95)" : i === hecha ? "#fff" : "rgba(255,255,255,.55)";
        g.beginPath(); g.arc(a, b, i === hecha ? 4.5 : 2.6, 0, 7); g.fill();
      });
    }
    if (!pos) return;
    const [x, y] = this.px(pos.x, pos.y);
    if (pos.rumbo !== null) {                       // cono de vista
      const grad = g.createRadialGradient(x, y, 2, x, y, 4.2 * e);
      grad.addColorStop(0, "rgba(240,138,36,.6)"); grad.addColorStop(1, "rgba(240,138,36,0)");
      g.fillStyle = grad;
      g.beginPath(); g.moveTo(x, y); g.arc(x, y, 4.2 * e, pos.rumbo - 0.55, pos.rumbo + 0.55); g.closePath(); g.fill();
    }
    g.fillStyle = "rgba(240,138,36,.3)"; g.beginPath(); g.arc(x, y, 9, 0, 7); g.fill();
    g.fillStyle = "#f08a24"; g.strokeStyle = "#fff"; g.lineWidth = 2;
    g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill(); g.stroke();
  }
}
