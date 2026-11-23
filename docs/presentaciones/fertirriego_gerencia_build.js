// Presentación a gerencia · Fertirriego en AgroNotificaciones (informativa)
const path = require("path");
const pptxgen = require("pptxgenjs");
const sharp = require("sharp");
const React = require("react");
const RDS = require("react-dom/server");
const fa = require("react-icons/fa6");
const { applyTheme } = require("C:/Users/Hhernandez/.claude/skills/synced/3169a938-2531-4073-9dc9-0479ad9fe306_d7161ee7-a555-46f7-accc-6aff5ce04920/pptx/scripts/apply_theme.js");

const REPO = "C:/HENRYALVARADO2022/agronotificaciones";
const CAP = REPO + "/pruebas/qa/capturas/";
const OUT = path.join(__dirname, "Fertirriego_Presentacion_Gerencia.pptx");

const THEME = {
  name: "Fertirriego",
  headFontFace: "Cambria",
  bodyFontFace: "Calibri",
  colors: {
    dk1: "1B2A24", lt1: "FFFFFF", dk2: "123F33", lt2: "EDF3EE",
    accent1: "1F7A3A", accent2: "2A8C82", accent3: "D99A1E", accent4: "B8452E",
    accent5: "61756B", accent6: "A9CDB3", hlink: "1F7A3A", folHlink: "2A8C82",
  },
};
const HEX = THEME.colors;

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.333 x 7.5
pres.title = "Fertirriego en AgroNotificaciones";
pres.author = "Torre de Control";
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
const C = pres.SchemeColor;

// ---------- recursos ----------
async function icon(name, hex = "FFFFFF") {
  const Comp = fa[name];
  if (!Comp) throw new Error("Icono no existe: " + name);
  const svg = RDS.renderToStaticMarkup(React.createElement(Comp, { size: 256, color: "#" + hex }));
  const buf = await sharp(Buffer.from(svg)).resize(256, 256).png().toBuffer();
  return "image/png;base64," + buf.toString("base64");
}
async function logo() {
  const buf = await sharp(REPO + "/public/marca/logo.svg").resize(512, 512).png().toBuffer();
  return "image/png;base64," + buf.toString("base64");
}
// Captura de inicio de sesión: tapa el botón de desarrollo de Next (abajo a la izquierda)
async function loginShot() {
  const src = path.join(__dirname, "login2.png");
  const { data } = await sharp(src).extract({ left: 180, top: 2140, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
  const hex = "#" + [data[0], data[1], data[2]].map((v) => v.toString(16).padStart(2, "0")).join("");
  const rect = Buffer.from(`<svg width="140" height="140"><rect width="140" height="140" fill="${hex}"/></svg>`);
  const out = path.join(__dirname, "login_limpio.png");
  await sharp(src).composite([{ input: rect, left: 5, top: 2075 }]).png().toFile(out);
  return out;
}
const shot = (f) => (f.includes(":") ? f : CAP + f);
const ASPECT = 412 / 915;

// ---------- layouts ----------
pres.defineSlideMaster({
  title: "Portada",
  background: { color: HEX.dk2 },
  objects: [
    { placeholder: { options: { name: "title", type: "title", x: 0.7, y: 2.0, w: 8.0, h: 1.5, fontSize: 48, bold: true, color: C.background1, fontFace: THEME.headFontFace, valign: "bottom", align: "left", margin: 0 }, text: "" } },
    { placeholder: { options: { name: "body", type: "body", x: 0.7, y: 3.7, w: 7.6, h: 1.4, fontSize: 20, color: C.accent6, valign: "top", margin: 0 }, text: "" } },
  ],
});
pres.defineSlideMaster({
  title: "Seccion",
  background: { color: HEX.dk2 },
  objects: [
    { placeholder: { options: { name: "title", type: "title", x: 0.9, y: 2.5, w: 8.6, h: 1.3, fontSize: 42, bold: true, color: C.background1, fontFace: THEME.headFontFace, valign: "bottom", align: "left", margin: 0 }, text: "" } },
    { placeholder: { options: { name: "body", type: "body", x: 0.9, y: 3.95, w: 8.6, h: 1.2, fontSize: 20, color: C.accent6, valign: "top", margin: 0 }, text: "" } },
  ],
  slideNumber: { x: 12.3, y: 6.95, w: 0.6, h: 0.3, fontSize: 10, color: C.accent6, align: "right" },
});
pres.defineSlideMaster({
  title: "Contenido",
  background: { color: HEX.lt1 },
  objects: [
    { placeholder: { options: { name: "title", type: "title", x: 0.6, y: 0.35, w: 12.1, h: 0.85, fontSize: 30, bold: true, color: C.text2, fontFace: THEME.headFontFace, valign: "middle", align: "left", margin: 0 }, text: "" } },
    { text: { text: "Fertirriego en AgroNotificaciones", options: { x: 0.6, y: 6.98, w: 6, h: 0.3, fontSize: 10, color: C.accent5, margin: 0 } } },
  ],
  slideNumber: { x: 12.1, y: 6.98, w: 0.6, h: 0.3, fontSize: 10, color: C.accent5, align: "right" },
});

let sec = "";
function slide(master, title, body) {
  const s = pres.addSlide({ masterName: master, sectionTitle: sec });
  if (title) s.addText(title, { placeholder: "title" });
  if (body) s.addText(body, { placeholder: "body" });
  return s;
}
function section(t) { sec = t; pres.addSection({ title: t }); }

// ---------- piezas ----------
function phone(s, file, x, y, h, name) {
  const pad = 0.09;
  const iw = (h - 2 * pad) * ASPECT;
  const w = iw + 2 * pad;
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x, y, w, h, rectRadius: 0.22, fill: { color: "0E1512" }, line: { color: "0E1512" },
    shadow: { type: "outer", color: "000000", blur: 10, offset: 4, angle: 90, opacity: 0.25 },
    objectName: name + " marco",
  });
  s.addImage({ path: shot(file), x: x + pad, y: y + pad, w: iw, h: h - 2 * pad, objectName: name + " captura", altText: "Captura de la app: " + name });
  return w;
}
function screen(s, file, x, y, w, aspect, name) {
  const pad = 0.08;
  const iw = w - 2 * pad, ih = iw / aspect;
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x, y, w, h: ih + 2 * pad, rectRadius: 0.1, fill: { color: "0E1512" }, line: { color: "0E1512" },
    shadow: { type: "outer", color: "000000", blur: 10, offset: 4, angle: 90, opacity: 0.25 }, objectName: name + " marco",
  });
  s.addImage({ path: shot(file), x: x + pad, y: y + pad, w: iw, h: ih, objectName: name + " captura", altText: "Captura de la app: " + name });
}
function circleIcon(s, data, x, y, d, fill, name) {
  s.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: fill }, line: { color: fill }, objectName: name + " circulo" });
  const p = d * 0.25;
  s.addImage({ data, x: x + p, y: y + p, w: d - 2 * p, h: d - 2 * p, objectName: name + " icono" });
}
function txt(s, text, o) { s.addText(text, Object.assign({ isTextBox: true, margin: 0, fontSize: 15, color: C.text1, valign: "top" }, o)); }
function points(s, items, x, y, w, h, fs = 17) {
  const runs = [];
  items.forEach(([t, d], i) => {
    runs.push({ text: t, options: { bold: true, color: C.text2, fontSize: fs + 1, breakLine: true } });
    runs.push({ text: d, options: { color: C.text1, fontSize: fs, breakLine: i < items.length - 1, paraSpaceAfter: 12 } });
  });
  s.addText(runs, { x, y, w, h, isTextBox: true, margin: 0, valign: "top", objectName: "Puntos" });
}
function steps(s, items, x, y, w, rowH, fs = 16) {
  items.forEach((t, i) => {
    const yy = y + i * rowH;
    s.addShape(pres.shapes.OVAL, { x, y: yy, w: 0.48, h: 0.48, fill: { color: HEX.accent1 }, line: { color: HEX.accent1 }, objectName: "Paso " + (i + 1) });
    txt(s, String(i + 1), { x, y: yy, w: 0.48, h: 0.48, fontSize: 15, bold: true, color: C.background1, align: "center", valign: "middle" });
    txt(s, t, { x: x + 0.7, y: yy - 0.02, w: w - 0.7, h: rowH - 0.05, fontSize: fs, valign: "top" });
  });
}
function card(s, x, y, w, h, fill, name) {
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.12, fill: { color: fill }, line: { color: fill }, objectName: name });
}
function table(s, rows, o) {
  const fs = o.fontSize || 15;
  s.addTable(rows.map((r, i) => r.map((c, j) => ({
    text: c,
    options: i === 0
      ? { bold: true, color: C.background1, fill: { color: HEX.dk2 }, fontSize: fs, align: o.center && j > 0 ? "center" : "left" }
      : { color: j === 0 ? C.text2 : C.text1, bold: j === 0, fill: { color: i % 2 ? HEX.lt1 : HEX.lt2 }, fontSize: fs, align: o.center && j > 0 ? "center" : "left" },
  }))), { x: o.x || 0.6, y: o.y || 1.45, w: o.w || 12.1, colW: o.colW, rowH: o.rowH, border: { type: "solid", pt: 0.5, color: HEX.accent6 }, valign: "middle", margin: [0, 0.12, 0, 0.12], objectName: o.name });
}
function grid(s, items, cols, x0, y0, cw, ch, fill, iconFill, name, fsT = 18, fsD = 15) {
  items.forEach(([ic, t, d], i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const x = x0 + col * (cw + 0.25), y = y0 + row * (ch + 0.25);
    if (fill) card(s, x, y, cw, ch, fill, name + " " + (i + 1));
    const pad = fill ? 0.25 : 0;
    circleIcon(s, ic, x + pad, y + pad, 0.7, iconFill, name + " " + (i + 1));
    txt(s, t, { x: x + pad + 0.88, y: y + pad, w: cw - 2 * pad - 0.88, h: 0.7, fontSize: fsT, bold: true, color: C.text2, valign: "middle" });
    txt(s, d, { x: x + pad, y: y + pad + 0.85, w: cw - 2 * pad, h: ch - pad - 0.95, fontSize: fsD });
  });
}

(async () => {
  const I = {};
  const need = { truck: "FaTruck", drop: "FaDroplet", wifi: "FaWifi", key: "FaKey", swap: "FaRightLeft", book: "FaBook",
    shield: "FaShieldHalved", pin: "FaLocationDot", clock: "FaClock", lock: "FaLock", chart: "FaChartLine", users: "FaUsers",
    mobile: "FaMobileScreenButton", house: "FaWarehouse", check: "FaClipboardCheck", ushield: "FaUserShield", flask: "FaFlask",
    calc: "FaCalculator", warn: "FaTriangleExclamation", hand: "FaHandshake", eye: "FaEye", boxes: "FaBoxesStacked",
    sign: "FaFileSignature", user: "FaUserCheck", pen: "FaPenToSquare", tie: "FaUserTie", gear: "FaGear", desk: "FaDesktop",
    robot: "FaServer", hat: "FaHelmetSafety", ban: "FaBan", thumbs: "FaThumbsUp", list: "FaListCheck", school: "FaChalkboardUser",
    battery: "FaBatteryQuarter", sync: "FaArrowsRotate", plus: "FaCirclePlus", minus: "FaCircleMinus", history: "FaClockRotateLeft" };
  for (const [k, n] of Object.entries(need)) I[k] = await icon(n);
  const ARROW_G = await icon("FaArrowRight", HEX.accent5);
  const LOGO = await logo();
  const LOGIN = await loginShot();

  // =================== APERTURA ===================
  section("Apertura");
  let s = slide("Portada", "Fertirriego en AgroNotificaciones", "Qué es, para qué nos sirve, quién lo usa y cómo funciona");
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.7, y: 0.7, w: 1.1, h: 1.1, rectRadius: 0.15, fill: { color: "FDFDFD" }, line: { color: "FDFDFD" }, objectName: "Logo fondo" });
  s.addImage({ data: LOGO, x: 0.75, y: 0.75, w: 1.0, h: 1.0, objectName: "Logo", altText: "Logotipo de AgroNotificaciones" });
  txt(s, "AgroNotificaciones + AGL Gestión", { x: 2.05, y: 0.95, w: 5, h: 0.6, fontSize: 18, color: C.background1, valign: "middle" });
  txt(s, "Presentación a gerencia\n14 de noviembre de 2026", { x: 0.7, y: 5.7, w: 7, h: 0.9, fontSize: 16, color: C.background1 });
  phone(s, "fert_estacion_movil.png", 9.3, 0.55, 6.4, "Estacion");
  s.addNotes("Buenos días. Hoy les presento el módulo de Fertirriego dentro de AgroNotificaciones: qué es, para qué nos sirve, quién lo usa, cómo se instala y se usa, cómo se administra, qué tan seguro es, y sus ventajas y desventajas.");

  s = slide("Contenido", "De qué vamos a hablar");
  const ag = ["Qué es Fertirriego y por qué lo necesitamos", "En qué nos beneficia", "Quién lo usa y la diferencia entre roles",
    "Instalación e inicio de sesión", "Manual del estacionero", "Manual del jefe de zona", "Administración: usuarios, roles y permisos",
    "La oficina (AGL) y la seguridad", "Ventajas y desventajas", "Qué se hará y cómo se hará"];
  ag.forEach((t, i) => {
    const col = Math.floor(i / 5), row = i % 5;
    const x = 0.6 + col * 6.15, y = 1.55 + row * 1.0;
    txt(s, String(i + 1).padStart(2, "0"), { x, y, w: 0.8, h: 0.7, fontSize: 26, bold: true, color: C.accent1, fontFace: THEME.headFontFace, valign: "middle" });
    txt(s, t, { x: x + 0.95, y, w: 5.0, h: 0.7, fontSize: 19, color: C.text2, valign: "middle" });
  });
  s.addNotes("Este es el recorrido. Primero el porqué y los beneficios; después quién lo usa, cómo se instala y cómo se usa en campo y en la supervisión; luego la administración y la seguridad; y al final un balance honesto de ventajas y desventajas, y cómo lo vamos a poner en marcha.");

  // =================== QUÉ ES ===================
  section("Qué es");
  s = slide("Seccion", "Qué es Fertirriego", "El control del producto de nutrición en cada estación de riego, registrado desde el teléfono del estacionero.");
  circleIcon(s, I.drop, 10.6, 2.6, 1.8, HEX.accent1, "Que es");
  s.addNotes("Empecemos por qué es y por qué lo necesitamos.");

  s = slide("Contenido", "Hoy no sabemos qué pasa con el producto en las estaciones");
  const prob = [
    [I.house, "¿Cuánto hay en cada estación?", "El producto en la estación sigue siendo inventario del almacén (consignación), pero nadie lo lleva al día."],
    [I.drop, "¿Cuánto se aplicó a cada turno?", "No hay un registro por turno y por día que se pueda comparar con el plan."],
    [I.user, "¿Quién lo tenía cuando faltó?", "En el cambio de jornada no queda constancia: si falta producto, no se sabe en qué turno de trabajo pasó."],
    [I.chart, "¿Cuadra con SAP?", "Lo que sale del almacén a la orden del turno no se compara con lo que de verdad se aplicó."],
  ];
  prob.forEach(([ic, t, d], i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = 0.6 + col * 6.15, y = 1.5 + row * 2.6;
    card(s, x, y, 5.95, 2.35, HEX.lt2, "Problema " + (i + 1));
    circleIcon(s, ic, x + 0.3, y + 0.3, 0.75, HEX.accent4, "Problema " + (i + 1));
    txt(s, t, { x: x + 1.3, y: y + 0.3, w: 4.4, h: 0.75, fontSize: 19, bold: true, color: C.text2, valign: "middle" });
    txt(s, d, { x: x + 1.3, y: y + 1.12, w: 4.4, h: 1.1, fontSize: 15 });
  });
  s.addNotes("Estas son las cuatro preguntas que hoy no podemos contestar con certeza. El producto que está en la estación sigue siendo del almacén hasta que se aplica: es consignación. Y hoy nadie lo lleva al día.");

  s = slide("Contenido", "Fertirriego cierra la cadena del plan al campo");
  const chain = [
    [I.book, "Plan asignado", "AGL calcula qué producto lleva cada turno y cada día (DDT)."],
    [I.boxes, "Salida de SAP", "Lo que el almacén carga a la orden del turno."],
    [I.drop, "Aplicado en campo", "Lo que el estacionero preparó en el tanque, registrado en el momento."],
  ];
  chain.forEach(([ic, t, d], i) => {
    const x = 0.6 + i * 4.25;
    card(s, x, 1.55, 3.7, 2.9, i === 2 ? HEX.accent1 : HEX.lt2, "Cadena " + (i + 1));
    circleIcon(s, ic, x + 0.3, 1.8, 0.8, i === 2 ? HEX.dk2 : HEX.accent1, "Cadena " + (i + 1));
    txt(s, t, { x: x + 0.3, y: 2.75, w: 3.1, h: 0.5, fontSize: 20, bold: true, color: i === 2 ? C.background1 : C.text2 });
    txt(s, d, { x: x + 0.3, y: 3.3, w: 3.1, h: 1.0, fontSize: 15, color: i === 2 ? C.background1 : C.text1 });
    if (i < 2) s.addImage({ data: ARROW_G, x: x + 3.82, y: 2.8, w: 0.32, h: 0.32, objectName: "Flecha " + (i + 1) });
  });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.6, y: 4.85, w: 12.1, h: 1.75, rectRadius: 0.12, fill: { color: HEX.lt1 }, line: { color: HEX.accent6, width: 1.25 }, objectName: "Formula" });
  txt(s, "Consignación = recibido − aplicado", { x: 0.95, y: 5.0, w: 8, h: 0.75, fontSize: 28, bold: true, color: C.text2, fontFace: THEME.headFontFace, valign: "middle" });
  txt(s, "Es el saldo de la bodega de cada estación. Lo calcula lo que registra el estacionero; SAP solo se usa para comparar.", { x: 0.95, y: 5.75, w: 11.4, h: 0.7, fontSize: 15 });
  s.addNotes("Tres números por turno: lo planificado, lo que salió de SAP y lo que de verdad se aplicó. El saldo de cada estación es lo recibido menos lo aplicado. SAP no calcula ese saldo: solo sirve para comparar.");

  s = slide("Contenido", "Dos sistemas que ya usamos, un solo flujo");
  const boxes = [
    [I.chart, "AGL Gestión (oficina)", "Turnos, estaciones, productos y plan. Comparativo y análisis."],
    [I.lock, "Base intermedia", "Solo guarda lo que el campo necesita mientras se usa. Lo terminado se baja a AGL."],
    [I.mobile, "Teléfono del estacionero", "Registra lo que pasa en la estación, con o sin señal."],
  ];
  boxes.forEach(([ic, t, d], i) => {
    const x = 0.6 + i * 4.25;
    if (i === 1) s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 1.6, w: 3.7, h: 2.6, rectRadius: 0.12, fill: { color: HEX.lt1 }, line: { color: HEX.accent6, width: 1.25, dashType: "dash" }, objectName: "Base borde" });
    else card(s, x, 1.6, 3.7, 2.6, HEX.lt2, "Sistema " + (i + 1));
    circleIcon(s, ic, x + 0.3, 1.85, 0.75, HEX.accent2, "Sistema " + (i + 1));
    txt(s, t, { x: x + 0.3, y: 2.72, w: 3.2, h: 0.5, fontSize: 18, bold: true, color: C.text2 });
    txt(s, d, { x: x + 0.3, y: 3.22, w: 3.2, h: 0.9, fontSize: 14 });
  });
  txt(s, "Publica plan y turnos  ⟶", { x: 4.3, y: 4.35, w: 4.5, h: 0.4, fontSize: 14, color: C.accent1, bold: true, align: "center" });
  txt(s, "⟵  Baja todo lo registrado", { x: 4.3, y: 4.75, w: 4.5, h: 0.4, fontSize: 14, color: C.accent2, bold: true, align: "center" });
  [["AGL manda", "en el plan, los turnos y los productos."], ["El campo manda", "en lo que de verdad pasó."], ["SAP", "se usa para comparar."]].forEach(([a, b], i) => {
    s.addText([{ text: a + " ", options: { bold: true, color: C.text2 } }, { text: b, options: { color: C.text1 } }], { x: 0.6 + i * 4.25, y: 5.4, w: 3.7, h: 0.9, fontSize: 16, isTextBox: true, margin: 0, valign: "top", objectName: "Regla " + (i + 1) });
  });
  s.addNotes("No es un sistema aparte: une AGL, que ya usa la Torre de Control, con AgroNotificaciones, que ya usan en campo. La base intermedia guarda lo mínimo; cuando un turno termina su ciclo, AGL lo baja y lo borra de ahí, para que el almacenamiento no genere costos.");

  // =================== BENEFICIOS ===================
  section("Beneficios");
  s = slide("Contenido", "En qué nos beneficia");
  grid(s, [
    [I.house, "Inventario al día por estación", "Saldo de cada producto después de cada movimiento."],
    [I.chart, "Plan contra aplicado", "Por turno y por DDT, con la diferencia a la vista."],
    [I.ushield, "Un responsable por jornada", "La estación siempre está a cargo de una sola persona."],
    [I.wifi, "Funciona sin señal", "Se registra en el momento; se envía al volver la señal."],
    [I.pen, "Menos papel y menos errores", "Productos del plan ya cargados, calculadora de bultos, borradores."],
    [I.truck, "Base para decidir envíos", "Con saldos y consumo reales se sabe cuánto mandar y a dónde."],
  ], 3, 0.6, 1.5, 3.85, 2.35, HEX.lt2, HEX.accent1, "Beneficio");
  s.addNotes("Seis beneficios concretos. Destaco dos: el responsable por jornada, que protege también al estacionero honrado; y que funciona sin señal, porque en las estaciones la señal es intermitente.");

  // =================== QUIÉN LO USA ===================
  section("Quién lo usa");
  s = slide("Seccion", "Quién lo usa", "Cada persona ve y hace solo lo que le toca, según su rol y su zona.");
  circleIcon(s, I.users, 10.6, 2.6, 1.8, HEX.accent1, "Quien");
  s.addNotes("Ahora, quién lo usa y qué diferencia hay entre un rol y otro.");

  s = slide("Contenido", "Las personas que participan");
  grid(s, [
    [I.hat, "Estacionero", "Registra en su teléfono lo que pasa en SU estación: recibe, aplica, cuenta, entrega y recibe la jornada."],
    [I.user, "Parametrista", "Apoya la supervisión de las estaciones de su zona: corrige, anula con motivo y registra por quien no tiene teléfono."],
    [I.tie, "Jefe de zona", "Responsable de las estaciones de su zona: asigna personas y custodia, autoriza traslados, revisa a diario."],
    [I.desk, "Torre de Control", "Administra usuarios y permisos, publica el plan desde AGL y analiza todo."],
    [I.eye, "Gerencia", "Consulta saldos, aplicaciones y comparativos de todas las estaciones."],
    [I.robot, "Usuario técnico de AGL", "No es una persona: es la cuenta con la que AGL publica y baja datos, con permisos mínimos."],
  ], 3, 0.6, 1.5, 3.85, 2.35, HEX.lt2, HEX.accent2, "Actor", 18, 14);
  s.addNotes("Estos son los participantes. El chofer no usa la app: el estacionero registra quién entregó y en qué vehículo. El usuario técnico de AGL es solo una cuenta de sistema.");

  s = slide("Contenido", "La diferencia entre un rol y otro");
  table(s, [
    ["Qué puede hacer", "Estacionero", "Parametrista", "Jefe de zona", "Torre de Control"],
    ["Ver estación, bodega, bitácora y turnos", "✓", "✓", "✓", "✓"],
    ["Recibir, aplicar, contar y anotar horas", "✓", "✓", "✓", "✓"],
    ["Entregar y recibir la estación (relevo)", "✓", "✓", "✓", "✓"],
    ["Pedir traslados", "✓", "✓", "✓", "✓"],
    ["Autorizar traslados", "—", "Opcional", "✓", "✓"],
    ["Anular registros de otros o de días pasados", "—", "✓", "✓", "✓"],
    ["Registrar a nombre de otro", "—", "✓", "✓", "✓"],
    ["Validar choferes, vehículos y productos de campo", "—", "✓", "✓", "✓"],
    ["Asignar personas y custodia de estaciones", "—", "—", "✓", "✓"],
    ["Sobre qué estaciones", "Las suyas", "Las de su zona", "Las de su zona", "Todas"],
  ], { y: 1.4, colW: [4.9, 1.8, 1.8, 1.8, 1.8], rowH: 0.44, fontSize: 14, center: true, name: "Tabla roles" });
  txt(s, "Es la configuración sugerida. Cada rol se ajusta en la pantalla Permisos, sin programar. Gerencia puede tener solo «Ver» sobre todas.", { x: 0.6, y: 6.35, w: 12.1, h: 0.5, fontSize: 14, color: C.accent5, italic: true });
  s.addNotes("La diferencia está en tres niveles. El estacionero opera sus estaciones. El parametrista y el jefe de zona además supervisan: anulan con motivo, registran por otro y autorizan traslados en su zona. El jefe además asigna personas y la custodia. Torre de Control tiene todo y sobre todas las estaciones.");

  s = slide("Contenido", "Cada permiso tiene un nivel y un alcance");
  table(s, [
    ["Nivel", "Qué enciende"],
    ["Ver", "Consultar y exportar"],
    ["Operar", "Además: recibir, aplicar, contar, relevo y trasladar"],
    ["Supervisar", "Además: anular, registrar por otro, autorizar traslados, validar choferes"],
    ["Todo", "Además: asignar personas y custodia, configurar el módulo"],
  ], { x: 0.6, y: 1.45, w: 7.3, colW: [1.8, 5.5], rowH: 0.75, fontSize: 15, name: "Tabla niveles" });
  table(s, [
    ["Alcance", "Sobre qué estaciones"],
    ["Sus estaciones", "Solo las asignadas"],
    ["Sus zonas", "Las de sus zonas"],
    ["Todas", "Todas las estaciones"],
  ], { x: 8.2, y: 1.45, w: 4.5, colW: [1.9, 2.6], rowH: 0.75, fontSize: 15, name: "Tabla alcance" });
  card(s, 0.6, 5.5, 12.1, 1.1, HEX.lt2, "Regla roles");
  txt(s, "Una persona puede tener varios roles: se suman y gana el alcance más amplio. Nada está escrito en el código; la base de datos lo hace cumplir.", { x: 0.9, y: 5.6, w: 11.5, h: 0.9, fontSize: 16, color: C.text2, valign: "middle" });
  s.addNotes("Cada permiso tiene un nivel, de Ver a Todo, y un alcance: sus estaciones, sus zonas o todas. Si alguien tiene dos roles, se suman.");

  // =================== INSTALACIÓN ===================
  section("Instalación e inicio de sesión");
  s = slide("Seccion", "Instalación e inicio de sesión", "Se instala desde el navegador del teléfono, sin tienda de aplicaciones.");
  phone(s, LOGIN, 10.0, 0.6, 6.3, "Inicio de sesion");
  s.addNotes("Así se instala y se entra por primera vez.");

  s = slide("Contenido", "Antes de empezar");
  grid(s, [
    [I.user, "Usuario y contraseña", "Los crea el administrador o el jefe de zona. Uno por persona; no se presta."],
    [I.house, "Estación asignada", "Sin estación asignada, la pantalla dice «No tienes estaciones asignadas»."],
    [I.mobile, "Teléfono con Chrome", "No hace falta tienda de aplicaciones: se instala desde el navegador."],
    [I.pin, "Ubicación activada", "Cada registro guarda dónde se hizo; sin GPS se guarda igual, marcado."],
    [I.clock, "Fecha y hora automáticas", "Si la hora del teléfono está mal, el registro queda marcado."],
    [I.wifi, "Abrirla una vez con señal", "Baja estaciones, turnos, plan, productos y las llaves del relevo."],
  ], 3, 0.6, 1.5, 3.85, 2.35, HEX.lt2, HEX.accent1, "Requisito", 18, 15);
  s.addNotes("Seis requisitos antes del primer uso. El más olvidado: abrir la app una vez con señal después de que le asignan la estación, porque ahí baja las llaves del relevo.");

  s = slide("Contenido", "Iniciar sesión e instalar en el teléfono");
  phone(s, LOGIN, 0.9, 1.35, 5.45, "Inicio de sesion");
  steps(s, [
    "Abrir en Chrome la dirección de AgroNotificaciones.",
    "Escribir el correo y la contraseña, y tocar «Ingresar».",
    "Abrir «Fertirriego» desde el menú.",
    "En el menú del navegador (⋮), tocar «Instalar aplicación» o «Agregar a la pantalla principal».",
    "Permitir la ubicación cuando el teléfono lo pregunte.",
    "Comprobar que aparece su estación. Desde aquí funciona sin señal.",
  ], 4.4, 1.6, 8.2, 0.85, 17);
  s.addNotes("Seis pasos. Queda un ícono como cualquier aplicación. Si alguien no tiene cuenta, la pantalla le dice que la pida al administrador.");

  s = slide("Contenido", "El primer día en la estación");
  phone(s, "fert_ayuda.png", 0.9, 1.35, 5.45, "Ayuda");
  points(s, [
    ["1. El jefe le asigna la estación", "La estación queda «a su cargo» (custodia). Solo una persona a la vez."],
    ["2. Conteo inicial", "Toca «Contar» y escribe lo que hay físicamente. Queda como saldo inicial."],
    ["3. Desde ahí, registrar en el momento", "Cada recepción y cada aplicación, cuando pasan."],
    ["Ayuda dentro de la app", "«¿Cómo se usa?» abre el manual del estacionero en el mismo teléfono, sin señal."],
  ], 4.4, 1.6, 8.2, 5.2, 17);
  s.addNotes("El primer día: el jefe le asigna la estación y el estacionero hace el conteo inicial. Ese conteo es la base de todo. Si tiene dudas, el manual está dentro de la app.");

  // =================== MANUAL ESTACIONERO ===================
  section("Manual del estacionero");
  s = slide("Seccion", "Manual del estacionero", "Un día de trabajo en el teléfono. Capturas reales de la prueba piloto (nombres de prueba).");
  phone(s, "piloto_turno.png", 10.0, 0.6, 6.3, "Por turno");
  s.addNotes("Ahora el manual de uso del estacionero. Las capturas son reales, de la prueba piloto; los nombres que se ven son de prueba.");

  s = slide("Contenido", "Una jornada en cinco pasos");
  const st = [
    [I.key, "Recibir la estación", "Con el código del compañero que entrega."],
    [I.truck, "Recibir producto", "Lo que bajó el camión, con chofer y vehículo."],
    [I.flask, "Aplicar", "Al preparar el tanque de cada turno."],
    [I.clock, "Anotar horas", "De fertilización y de riego del turno."],
    [I.hand, "Entregar la estación", "Con novedades y su código."],
  ];
  s.addShape(pres.shapes.LINE, { x: 1.25, y: 2.35, w: 10.4, h: 0, line: { color: HEX.accent6, width: 2 }, objectName: "Linea tiempo" });
  st.forEach(([ic, t, d], i) => {
    const x = 0.6 + i * 2.5;
    circleIcon(s, ic, x + 0.3, 1.9, 0.9, HEX.accent1, "Paso " + (i + 1));
    txt(s, String(i + 1), { x: x + 0.3, y: 3.0, w: 0.9, h: 0.5, fontSize: 22, bold: true, color: C.accent3, align: "center", fontFace: THEME.headFontFace });
    txt(s, t, { x, y: 3.55, w: 2.3, h: 0.75, fontSize: 18, bold: true, color: C.text2 });
    txt(s, d, { x, y: 4.3, w: 2.3, h: 1.0, fontSize: 15 });
  });
  card(s, 0.6, 5.6, 12.1, 1.0, HEX.lt2, "Regla de oro");
  txt(s, "Regla de oro: lo que entra y sale de la bodega se registra en el momento. Si no se registra, aparece como faltante.", { x: 0.95, y: 5.7, w: 11.4, h: 0.8, fontSize: 17, color: C.text2, bold: true, valign: "middle" });
  s.addNotes("Así es una jornada. Recibe la estación con código, registra lo que llega, aplica al preparar cada tanque, anota las horas y al final entrega la estación con su código.");

  function shotSlide(title, file, name, items, notes) {
    const sl = slide("Contenido", title);
    phone(sl, file, 0.9, 1.35, 5.45, name);
    points(sl, items, 4.4, 1.6, 8.2, 5.2, 17);
    sl.addNotes(notes);
    return sl;
  }

  shotSlide("La pantalla de la estación", "fert_estacion_movil.png", "Estacion", [
    ["Barra de señal", "Dice si hay señal y cuántos registros esperan envío. «Actualizar» envía y trae lo último."],
    ["«La estación está a tu cargo»", "Solo quien tiene la estación a cargo puede registrar en ella."],
    ["Botones grandes", "Recibir, Aplicar, Contar y Envases, para usar con el dedo en campo."],
    ["Pestañas", "Estación, Por turno, Bitácora, Relevos, Traslados y Envíos."],
    ["Plan de hoy y bodega", "Qué toca aplicar hoy y cuánto hay; los fertilizantes van primero."],
  ], "La pantalla principal: la barra de señal, quién tiene la estación a cargo, los botones grandes, las pestañas y abajo el plan de hoy y la bodega.");

  shotSlide("Recibir producto del camión", "piloto_recibir.png", "Recibir", [
    ["Los productos del plan ya vienen", "Con lo planificado para 7 días al lado; se escribe lo que bajó."],
    ["Chofer y vehículo", "De una lista; si es nuevo se agrega en el momento y queda por validar."],
    ["Calculadora de bultos", "Bultos × kilos por bulto, sin sacar cuentas a mano."],
    ["Envases", "Barriles y canecas que llegan llenos y los vacíos que se lleva el chofer."],
    ["Nada se pierde", "Si lo interrumpen, queda como borrador hasta que lo guarde."],
  ], "Cuando llega el camión, toca Recibir. Los productos del plan ya aparecen; solo escribe lo que bajó, con chofer, vehículo y envases.");

  shotSlide("Aplicar por turno: plan contra real", "piloto_turno.png", "Por turno", [
    ["Cada día del plan (DDT)", "Muestra el plan, lo aplicado y la diferencia por producto."],
    ["Aplicar descuenta la bodega", "En el momento en que el producto sale al tanque."],
    ["Lo que no estaba en el plan", "Se registra como «Extra» y queda marcado para la oficina."],
    ["Horas", "Horas de fertilización y de riego del turno, y quién lo ejecutó."],
  ], "Por turno ve cada día del plan con lo planificado, lo real y la diferencia. Al aplicar, la bodega se descuenta. Lo fuera del plan queda marcado como Extra.");

  shotSlide("Corregir sin borrar: anular y devolver sobrante", "fert_devolucion_diag.png", "Devolver sobrante", [
    ["Devolver sobrante", "Si no se usó todo, regresa a la bodega con el motivo de por qué sobró."],
    ["Anular", "Un error se anula con motivo; el registro original queda a la vista."],
    ["Quién anula", "El estacionero, lo suyo de su jornada. Lo de otros o de días pasados, el jefe."],
    ["Por qué no se edita", "Para que nadie pueda cambiar lo que pasó. Así se protege a todos."],
  ], "Los errores no se borran: se anulan con motivo, o se devuelve el sobrante a la bodega. Es la pregunta típica en la charla: ¿por qué no puedo corregir la cantidad? Para que nadie cambie lo que pasó.");

  shotSlide("Sin señal, se trabaja igual", "fert_sin_senal.png", "Sin senal", [
    ["Barra naranja", "«Sin señal: se guarda en el teléfono» y cuántos registros faltan por enviar."],
    ["La bodega ya descuenta", "El saldo en el teléfono incluye lo que todavía no se envió."],
    ["Se envía solo", "Cuando vuelve la señal; cada registro llega una sola vez, sin duplicados."],
    ["Cuidado", "No borrar la aplicación ni los datos del navegador con registros por enviar."],
  ], "La app funciona sin señal: guarda en el teléfono, descuenta la bodega y envía sola cuando vuelve la señal, sin duplicar nada. Lo único que no se debe hacer es borrar la app con registros pendientes.");

  shotSlide("Cambio de jornada: quien entrega", "fert_codigo_relevo.png", "Relevo", [
    ["Cómo deja cada turno", "En aplicación, preparado en tanques, pendiente o terminado."],
    ["Novedades obligatorias", "Bombas, fugas, tanques: lo que debe saber quien recibe."],
    ["Código de 6 números", "Cambia cada 30 segundos y solo lo genera el teléfono de quien entrega. Funciona sin señal."],
    ["Queda bloqueado", "Desde que entrega ya no puede registrar, salvo que cancele la entrega."],
  ], "Esta es la parte más importante. Al terminar su jornada, el estacionero marca cómo deja cada turno, escribe novedades y muestra su código, que cambia cada 30 segundos.");

  shotSlide("Cambio de jornada: quien recibe", "piloto_codigo_largo.png", "Relevo largo", [
    ["Escribe el código en su teléfono", "Se verifica sin internet. 5 intentos equivocados lo bloquean 5 minutos."],
    ["Revisa la bodega", "«Conforme» o «No cuadra» con lo que de verdad hay."],
    ["Las diferencias tienen nombre", "Quedan en ese relevo, con quién entregó y quién recibió."],
    ["Relevo de noche", "Si no coinciden, un código de 12 horas (8 números) que se deja escrito o por WhatsApp."],
    ["Si la estación no está bien", "Puede no recibirla, con motivo; el jefe lo revisa."],
  ], "Quien recibe escribe el código en su teléfono y revisa la bodega. Si no cuadra, lo dice en ese momento y queda con nombre. Para el turno de noche existe un código de 12 horas.");

  s = slide("Contenido", "Traslados entre estaciones, siempre autorizados");
  phone(s, "fert_traslado_recibido.png", 0.9, 1.35, 5.45, "Traslados");
  [[I.sign, "Se pide", "El origen elige destino, productos, motivo y quién autoriza."],
   [I.user, "Se autoriza", "Lo aprueba otra persona; nadie se autoriza a sí mismo."],
   [I.check, "Se recibe", "El destino anota lo que llegó; si llegó menos, se marca. Si rechaza, vuelve al origen."]].forEach(([ic, t, d], i) => {
    const y = 1.55 + i * 1.65;
    circleIcon(s, ic, 4.4, y, 0.8, HEX.accent2, "Traslado " + (i + 1));
    txt(s, t, { x: 5.45, y, w: 7.0, h: 0.45, fontSize: 19, bold: true, color: C.text2 });
    txt(s, d, { x: 5.45, y: y + 0.48, w: 7.0, h: 0.9, fontSize: 16 });
  });
  s.addNotes("Cuando a una estación se le acaba un producto y otra tiene, se traslada, siempre con autorización de otra persona. Mientras va en camino nadie lo puede usar.");

  s = slide("Contenido", "Todo queda en la bitácora, con nombre, hora y lugar");
  phone(s, "piloto2_bitacora.png", 0.7, 1.35, 5.45, "Bitacora");
  phone(s, "piloto2_detalle.png", 3.4, 1.35, 5.45, "Detalle");
  points(s, [
    ["Kardex de la estación", "Cada entrada y salida con el saldo después del movimiento."],
    ["Filtros", "Por turno, producto, tipo, fecha y cantidad."],
    ["Detalle completo", "Quién, cuándo, chofer, vehículo, ubicación, hora en el teléfono y de llegada."],
    ["Envíos", "Lo que falta enviar y lo que la oficina no aceptó, con el motivo."],
  ], 6.4, 1.6, 6.3, 5.2, 17);
  s.addNotes("Todo movimiento queda en la bitácora con quién lo hizo, cuándo y dónde. En Envíos el estacionero ve lo pendiente y lo rechazado con su motivo.");

  // =================== MANUAL JEFE DE ZONA ===================
  section("Manual del jefe de zona");
  s = slide("Seccion", "Manual del jefe de zona", "También para el parametrista: supervisar las estaciones de su zona.");
  circleIcon(s, I.tie, 10.6, 2.6, 1.8, HEX.accent1, "Jefe");
  s.addNotes("Ahora el manual del jefe de zona, que aplica también al parametrista según sus permisos.");

  s = slide("Contenido", "Qué hace el jefe de zona");
  grid(s, [
    [I.users, "Asignar personas", "En Usuarios marca las estaciones de cada estacionero de su zona."],
    [I.key, "Asignar la custodia", "La primera vez, si el compañero no llegó o se perdió el código. Siempre con motivo."],
    [I.swap, "Autorizar traslados", "Revisa origen, destino, motivo y cantidades. Autoriza o no, con motivo."],
    [I.ban, "Anular y registrar por otro", "Corrige con motivo y registra por quien no tiene teléfono; queda su nombre."],
    [I.truck, "Validar choferes y productos", "Los nuevos que se crean en campo quedan «por validar» hasta que él los revisa."],
    [I.list, "Pedir conteos de control", "Cada semana o al cierre de mes: la diferencia queda a la vista de todos."],
  ], 3, 0.6, 1.5, 3.85, 2.35, HEX.lt2, HEX.accent1, "Jefe", 18, 14);
  s.addNotes("El jefe de zona es el mini administrador de sus estaciones. Asigna personas y la custodia, autoriza traslados, anula y registra por otro, valida choferes y productos nuevos, y pide conteos de control.");

  s = slide("Contenido", "Su revisión de cada día");
  table(s, [
    ["Dónde", "Qué buscar"],
    ["Estación › En bodega", "Productos en rojo (negativo): falta registrar una entrega o un conteo"],
    ["Por turno", "Turnos con lo aplicado muy distinto del plan"],
    ["Relevos", "Relevos con diferencias o rechazados"],
    ["Traslados", "Traslados en camino que nadie ha recibido o que llegaron incompletos"],
    ["Envíos de cada estacionero", "Registros no aceptados que no se han corregido"],
    ["AGL › Fertirriego", "Comparativo Plan · SAP · Aplicado y consignación por estación"],
  ], { y: 1.45, colW: [3.6, 8.5], rowH: 0.62, fontSize: 15, name: "Tabla revision" });
  s.addNotes("Esta es la lista de revisión diaria del jefe de zona: seis lugares y qué buscar en cada uno.");

  s = slide("Contenido", "Lo dudoso no se pierde: se marca para revisar");
  table(s, [
    ["Marca", "Qué significa", "Qué hace el jefe de zona"],
    ["Dejó el saldo en negativo", "Falta registrar una entrega o un conteo", "Buscar la entrega; si no aparece, pedir conteo"],
    ["Diferencia en el relevo", "Al recibir la estación no cuadró", "Hablar con quien entregó y quien recibió"],
    ["Llegó menos de lo enviado", "En un traslado llegó menos", "Revisar con origen y destino"],
    ["Producto fuera del plan", "Se aplicó algo no planificado", "Confirmar si fue un cambio autorizado"],
    ["Hora del teléfono distinta", "El reloj del teléfono no coincide", "Pedir fecha y hora automáticas"],
    ["La estación no estaba a su cargo", "Registró sin tener la custodia", "Revisar si el relevo se hizo bien"],
  ], { y: 1.45, colW: [3.6, 4.1, 4.4], rowH: 0.62, fontSize: 15, name: "Tabla marcas" });
  txt(s, "Un registro de campo nunca se pierde: lo que llega dudoso se acepta, se marca y se revisa.", { x: 0.6, y: 6.0, w: 12.1, h: 0.6, fontSize: 17, bold: true, color: C.accent1 });
  s.addNotes("Lo que llega dudoso no se rechaza ni se pierde: se acepta y se marca. Esta tabla es la guía del jefe.");

  // =================== ADMINISTRACIÓN ===================
  section("Administración");
  s = slide("Seccion", "Administración", "Usuarios, roles y permisos: se configuran en pantallas, sin programar.");
  circleIcon(s, I.gear, 10.6, 2.6, 1.8, HEX.accent1, "Admin");
  s.addNotes("Ahora la administración: cómo se crean usuarios y se dan permisos.");

  s = slide("Contenido", "La pantalla de Permisos");
  screen(s, "permisos_v2_escritorio.png", 0.6, 1.4, 7.4, 1440 / 900, "Permisos");
  points(s, [
    ["Elegir el rol", "Arriba, con búsqueda. Se puede crear, copiar o eliminar un rol."],
    ["Pantallas por módulo", "En cada una, un nivel de un toque: Sin acceso, Ver, Operar, Supervisar o Todo."],
    ["A la medida", "Se puede marcar acción por acción, por ejemplo anular pero no autorizar traslados."],
    ["Historial de cambios", "Quién cambió qué y cuándo."],
  ], 8.35, 1.5, 4.4, 5.3, 15);
  s.addNotes("En Permisos se elige un rol y, en cada pantalla, el nivel con un toque. Si hace falta algo a la medida, se marca acción por acción. Todo cambio queda en el historial.");

  s = slide("Contenido", "Dar de alta a un estacionero");
  screen(s, "permisos_delegacion_jefe.png", 0.6, 1.4, 6.6, 1440 / 900, "Ficha de usuario");
  steps(s, [
    "Usuarios › Nuevo: nombre, correo y contraseña.",
    "Rol «Estacionero» como principal.",
    "Su zona.",
    "Sus estaciones de riego.",
    "Guardar y revisar «Qué puede hacer».",
    "Entregarle el usuario; que instale y abra la app con señal.",
    "Asignarle la estación y hacer el conteo inicial.",
  ], 7.55, 1.5, 5.2, 0.72, 15);
  s.addNotes("Siete pasos para dar de alta a un estacionero. El paso clave es revisar «Qué puede hacer» antes de entregarle el usuario.");

  s = slide("Contenido", "Delegación y control de accesos");
  grid(s, [
    [I.tie, "Delegación a jefes de zona", "El jefe da de alta a su gente sin depender de Torre de Control: solo en sus zonas y solo con los roles que tiene permitidos."],
    [I.list, "«Qué puede hacer»", "La ficha de cada persona muestra sus permisos reales, por módulo, con el alcance y qué rol se los da."],
    [I.history, "Historial de accesos", "Quién le cambió roles, zonas, estaciones o permisos a cada persona, y cuándo."],
    [I.ban, "Desactivar al salir", "Cuando alguien sale de la empresa se desactiva; su historial se conserva."],
  ], 2, 0.6, 1.5, 5.92, 2.35, HEX.lt2, HEX.accent2, "Delegacion", 18, 15);
  s.addNotes("Los jefes de zona pueden dar de alta a su gente, pero solo en sus zonas y con los roles que les permitimos. Todo cambio de accesos queda en el historial.");

  // =================== OFICINA Y SEGURIDAD ===================
  section("Oficina y seguridad");
  s = slide("Contenido", "La oficina lo ve todo en AGL");
  grid(s, [
    [I.sync, "Sincronizar todo", "Un botón publica plan y turnos al campo y baja todo lo registrado."],
    [I.chart, "Comparativo Plan · SAP · Real", "Por turno, con gráficos y tablas de diferencias."],
    [I.house, "Consignación por estación", "Cuánto producto del almacén está en cada estación."],
    [I.eye, "Relevos y traslados a revisar", "Diferencias, rechazos y lo que llegó incompleto."],
    [I.flask, "Análisis de fertilizantes", "Solo los fertilizantes entran al análisis; lo demás es control de inventario."],
    [I.boxes, "Terminar ciclo", "Al cerrar el ciclo de un turno, AGL lo guarda y lo borra de la base intermedia."],
  ], 3, 0.6, 1.5, 3.85, 2.35, HEX.lt2, HEX.accent2, "AGL", 17, 14);
  s.addNotes("En la oficina, AGL reúne todo: sincroniza, compara plan contra SAP contra lo real, muestra la consignación por estación y lo que hay que revisar.");

  s = slide("Contenido", "Seguridad: seis controles que trabajan juntos");
  grid(s, [
    [I.book, "Libro que no se edita", "Nada se borra ni se cambia. Toda corrección es un movimiento nuevo con motivo y nombre."],
    [I.ushield, "Una persona a cargo", "Solo quien tiene la estación a cargo registra en ella."],
    [I.key, "Código del teléfono", "Se verifica en el teléfono y en el servidor. 5 intentos fallidos bloquean 5 minutos."],
    [I.pin, "Ubicación y hora", "Cada registro guarda dónde y cuándo; la hora se compara con la del servidor."],
    [I.swap, "Traslados con tercero", "Autoriza otra persona y el destino confirma lo que llegó."],
    [I.lock, "Permisos y conexión cifrada", "Cada quien ve solo sus estaciones. La conexión de AGL va cifrada con clave maestra."],
  ], 3, 0.6, 1.5, 3.85, 2.35, HEX.lt2, HEX.dk2, "Control", 17, 14);
  s.addNotes("Ningún control solo es infalible; juntos hacen muy difícil la trampa. Y protegen al estacionero honrado: si falta producto, se sabe en qué jornada pasó.");

  // =================== VENTAJAS Y DESVENTAJAS ===================
  section("Ventajas y desventajas");
  s = slide("Seccion", "Ventajas y desventajas", "Un balance honesto de lo que gana la empresa y de lo que hay que cuidar.");
  circleIcon(s, I.thumbs, 10.6, 2.6, 1.8, HEX.accent1, "Balance");
  s.addNotes("Ahora el balance: ventajas y desventajas.");

  s = slide("Contenido", "Ventajas");
  const vent = [
    ["Control al día", "Saldo de cada producto en cada estación, en el momento."],
    ["Responsable por jornada", "El relevo con código deja claro quién tenía el producto."],
    ["Funciona sin señal", "Pensado para las estaciones, donde la señal va y viene."],
    ["Plan · SAP · Real", "Diferencias por turno visibles para la oficina."],
    ["Trazabilidad completa", "Quién, cuándo, dónde y por qué de cada movimiento."],
    ["Protege al estacionero", "Las diferencias se declaran al recibir; no se culpa a quien no fue."],
    ["Permisos sin programar", "Roles, zonas y estaciones se ajustan en pantallas."],
    ["Desarrollo propio, costo bajo", "Adaptado a nuestro proceso, sin licencias por usuario y con almacenamiento mínimo."],
  ];
  vent.forEach(([t, d], i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = 0.6 + col * 6.15, y = 1.45 + row * 1.3;
    circleIcon(s, I.plus, x, y + 0.05, 0.55, HEX.accent1, "Ventaja " + (i + 1));
    txt(s, t, { x: x + 0.75, y, w: 5.2, h: 0.4, fontSize: 18, bold: true, color: C.text2 });
    txt(s, d, { x: x + 0.75, y: y + 0.42, w: 5.2, h: 0.75, fontSize: 15 });
  });
  s.addNotes("Ocho ventajas. Resalto la última: es un desarrollo propio, hecho a la medida de nuestro proceso, sin pagar licencias por usuario.");

  s = slide("Contenido", "Desventajas: las personas");
  table(s, [
    ["Desventaja", "Cómo la cubrimos"],
    ["Los estacioneros pueden no querer usarla: pedir que se les dé internet, teléfono o un pago por usarla", "Funciona sin señal: no necesita plan de datos, basta conectarse de vez en cuando. Capacitación práctica y mensaje claro: el relevo con código los protege"],
    ["Depende del teléfono personal (batería, espacio, teléfono dañado o perdido)", "El jefe registra por él; lo guardado en el teléfono se envía cuando vuelva a abrirlo"],
    ["Registrar tarde u olvidar registrar", "Saldos negativos y marcas a la vista; conteos de control"],
    ["Relevos sin código («después lo hago»)", "Sin relevo la estación no cambia de responsable; el jefe asigna con motivo y queda registrado"],
    ["Más trabajo para los jefes de zona (revisar, autorizar, asignar)", "Revisión diaria guiada en seis puntos y delegación de altas"],
  ], { y: 1.4, colW: [5.6, 6.5], rowH: [0.5, 1.0, 0.85, 0.7, 0.85, 0.85], fontSize: 14, name: "Tabla desventajas personas" });
  s.addNotes("La desventaja más grande es humana: que los estacioneros no quieran usarla, que pidan internet, teléfono o un pago extra. La respuesta: no necesita datos porque funciona sin señal, y les conviene porque los protege en el relevo. Pero hay que acompañarlos.");

  s = slide("Contenido", "Desventajas: lo técnico y lo operativo");
  table(s, [
    ["Desventaja", "Cómo la cubrimos"],
    ["El dato es tan bueno como lo que se digita: no pesa ni mide el producto solo", "Conteos de control y comparación con el plan y con SAP"],
    ["Si se borra la app o los datos con registros pendientes, se pierden", "La barra muestra «N por enviar»; se enseña en la capacitación"],
    ["Depende de que la oficina sincronice AGL: si no, el plan en campo se atrasa", "Sincronizar mañana y tarde; el asistente también puede hacerlo"],
    ["Al inicio puede haber doble trabajo (papel y app)", "Dejar el papel cuando la estación cuadre por dos semanas"],
    ["Es un sistema propio: depende de quién lo mantiene", "Manuales y documentación técnica al día"],
  ], { y: 1.4, colW: [5.6, 6.5], rowH: [0.5, 0.85, 0.85, 0.85, 0.75, 0.75], fontSize: 14, name: "Tabla desventajas tecnicas" });
  s.addNotes("Y las técnicas: la app no mide el producto sola, depende de lo que se digita; si se borra con pendientes se pierde; depende de que la oficina sincronice; al inicio puede haber doble trabajo; y por ser propio depende de quién lo mantiene. El criterio de dos semanas para dejar el papel es una sugerencia: ajústenlo si quieren.");

  // =================== QUÉ SE HARÁ ===================
  section("Qué se hará y cómo");
  s = slide("Contenido", "Dónde estamos hoy");
  const tl = [
    ["11 nov", "Diseño aprobado", "Bodega por estación, aplicación por turno, relevo y traslados."],
    ["11–12 nov", "Construcción", "App del teléfono sin señal, relevo con código, traslados y análisis en AGL."],
    ["12 nov", "Piloto 1", "Con estacioneros: 10 observaciones, todas atendidas."],
    ["13 nov", "Piloto 2", "7 pedidos más, atendidos: botones más grandes, filtros, envases, calculadora."],
    ["Hoy", "En marcha", "En producción con modo de pruebas y manuales para cada rol."],
  ];
  s.addShape(pres.shapes.LINE, { x: 0.9, y: 2.15, w: 11.5, h: 0, line: { color: HEX.accent6, width: 2 }, objectName: "Linea tiempo" });
  tl.forEach(([f, t, d], i) => {
    const x = 0.6 + i * 2.5;
    s.addShape(pres.shapes.OVAL, { x: x + 0.15, y: 1.97, w: 0.36, h: 0.36, fill: { color: i === 4 ? HEX.accent3 : HEX.accent1 }, line: { color: HEX.lt1, width: 2 }, objectName: "Hito " + (i + 1) });
    txt(s, f, { x, y: 1.4, w: 2.3, h: 0.45, fontSize: 15, bold: true, color: C.accent5 });
    txt(s, t, { x, y: 2.6, w: 2.3, h: 0.5, fontSize: 18, bold: true, color: C.text2 });
    txt(s, d, { x, y: 3.15, w: 2.3, h: 1.6, fontSize: 14 });
  });
  card(s, 0.6, 4.9, 12.1, 1.45, HEX.lt2, "Manuales");
  circleIcon(s, I.book, 0.9, 5.2, 0.8, HEX.accent1, "Manuales");
  txt(s, "Material listo: manual del estacionero, del jefe de zona, del administrador y de AGL, guion de la charla de 90 minutos y ayuda «¿Cómo se usa?» dentro de la app.", { x: 1.95, y: 5.05, w: 10.5, h: 1.15, fontSize: 16, valign: "middle" });
  s.addNotes("En tres días pasamos del diseño a dos pruebas piloto con estacioneros, y todo lo que pidieron se atendió. Hoy está en producción con modo de pruebas, que separa lo de prueba de lo real.");

  s = slide("Contenido", "Cómo se pondrá en marcha");
  [["Preparar", "Usuarios y permisos; cada estacionero asignado a su estación. AGL publica turnos, productos y plan."],
   ["Capacitar", "Charla de 90 minutos por grupo, con práctica en parejas y en modo avión."],
   ["Arrancar", "Conteo inicial en cada estación y relevo con código desde el primer día."],
   ["Acompañar", "AGL sincroniza mañana y tarde; los jefes de zona revisan las marcas a diario."],
   ["Pasar a uso real", "Apagar el modo de pruebas cuando las estaciones cuadren."]].forEach(([t, d], i) => {
    const y = 1.45 + i * 1.02;
    s.addShape(pres.shapes.OVAL, { x: 0.6, y, w: 0.7, h: 0.7, fill: { color: HEX.accent1 }, line: { color: HEX.accent1 }, objectName: "Fase " + (i + 1) });
    txt(s, String(i + 1), { x: 0.6, y, w: 0.7, h: 0.7, fontSize: 20, bold: true, color: C.background1, align: "center", valign: "middle", fontFace: THEME.headFontFace });
    txt(s, t, { x: 1.55, y: y + 0.02, w: 2.4, h: 0.66, fontSize: 19, bold: true, color: C.text2, valign: "middle" });
    txt(s, d, { x: 4.0, y: y + 0.02, w: 8.7, h: 0.66, fontSize: 16, valign: "middle" });
  });
  txt(s, "Después: alertas automáticas, sugerencia de envío por estación y cierre mensual.", { x: 0.6, y: 6.5, w: 12.1, h: 0.4, fontSize: 15, italic: true, color: C.accent5 });
  s.addNotes("Cinco fases para ponerlo en marcha. [Diga aquí las fechas y las zonas con que se arranca.] Después vienen las alertas automáticas, la sugerencia de envío y el cierre mensual.");

  s = slide("Contenido", "La capacitación de los estacioneros (90 minutos)");
  table(s, [
    ["Minutos", "Tema", "Cómo"],
    ["0–10", "Por qué lo hacemos", "Conversación"],
    ["10–25", "Instalar y primer ingreso", "Todos con su teléfono"],
    ["25–35", "La pantalla y la barra de señal", "Demostración"],
    ["35–50", "Contar, recibir y aplicar", "Práctica en parejas"],
    ["50–65", "Relevo con código", "En parejas, con el teléfono en modo avión"],
    ["65–75", "Traslados", "Demostración y una pareja"],
    ["75–85", "Errores: anular, devolver, «Envíos»", "Demostración"],
    ["85–90", "Preguntas y compromisos", "Conversación"],
  ], { y: 1.4, colW: [1.6, 5.4, 5.1], rowH: 0.55, fontSize: 15, name: "Tabla capacitacion" });
  s.addNotes("La capacitación ya está diseñada: 90 minutos, casi todo práctico, con el teléfono en modo avión para que vean que funciona sin señal.");

  // =================== CIERRE ===================
  section("Cierre");
  s = slide("Portada", null, "Saber cuánto producto hay en cada estación, cuánto se aplica a cada turno y quién lo tenía en cada momento.");
  s.addText([{ text: "En resumen", options: { fontSize: 44 } }], { placeholder: "title" });
  const res = ["Funciona en el teléfono, aun sin señal", "Cada rol ve y hace solo lo que le toca", "La oficina compara Plan · SAP · Real en AGL"];
  s.addText(res.map((t, i) => ({ text: t, options: { bullet: true, breakLine: i < res.length - 1, paraSpaceAfter: 8 } })),
    { x: 0.7, y: 5.0, w: 7.8, h: 1.5, fontSize: 18, color: C.background1, isTextBox: true, margin: 0, valign: "top", objectName: "Resumen" });
  phone(s, "fert_codigo_relevo.png", 9.3, 0.55, 6.4, "Relevo");
  s.addNotes("En resumen: sabremos cuánto producto hay en cada estación, cuánto se aplica a cada turno y quién lo tenía en cada momento. Funciona sin señal, cada rol ve lo suyo y la oficina compara contra el plan y SAP. ¿Preguntas?");

  await pres.writeFile({ fileName: OUT });
  await applyTheme(OUT, THEME);
  console.log("OK " + OUT);
})().catch((e) => { console.error(e); process.exit(1); });
