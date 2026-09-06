import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// All non-card illustrations are drawn here. No raster inputs, embedded images,
// external fonts, filters, or randomness: regenerate with `npm run art:build`.
// Every atlas keeps its original 4 × 4 cell contract (128 units per cell).
const output = resolve(import.meta.dirname, "../assets/ui");
const ink = "#172332", paper = "#fff4d7", gold = "#efb94f";
const red = "#e66a76", green = "#64bd9a", blue = "#78bad1", purple = "#b399d5";
const path = (d, fill = "none", stroke = ink, width = 4) => `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round"/>`;
const rect = (x, y, w, h, fill, stroke = ink, sw = 4, r = 3) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
const circle = (x, y, r, fill, stroke = ink, sw = 4) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
const group = (transform, content) => `<g transform="${transform}">${content}</g>`;
const star = (x, y, size = 8, color = gold) => group(`translate(${x} ${y}) scale(${size / 10})`, path("M0 -10 3 -3 10 0 3 3 0 10 -3 3 -10 0 -3 -3Z", color, "none"));
const shadow = () => `<ellipse cx="64" cy="113" rx="43" ry="5" fill="${ink}" opacity=".22"/>`;
const suitPaths = {
  heart: "M0 15 -17 -2 -17 -11 -10 -18 -3 -18 0 -13 3 -18 10 -18 17 -11 17 -2Z",
  diamond: "M0 -21 17 0 0 21 -17 0Z",
  spade: "M0 -22 18 -3 18 7 11 13 4 11 8 22 -8 22 -4 11 -11 13 -18 7 -18 -3Z",
  club: "M-6 0 -10 -6 -10 -14 -4 -20 4 -20 10 -14 10 -6 6 0 13 -3 20 3 20 11 14 17 5 15 9 24 -9 24 -5 15 -14 17 -20 11 -20 3 -13 -3Z"
};
const suit = (type, x, y, scale = 1, color = ink) => group(`translate(${x} ${y}) scale(${scale})`, path(suitPaths[type] || suitPaths.spade, color, "none"));
const bolt = (x = 64, y = 64, scale = 1, color = gold) => group(`translate(${x} ${y}) scale(${scale})`, path("M6 -38 -23 6 -3 6 -9 38 25 -10 5 -10Z", color));
const check = (x, y, scale = 1, color = paper) => group(`translate(${x} ${y}) scale(${scale})`, path("M-13 0 -3 10 16 -12", "none", color, 6));
const card = (x, y, angle = 0, type = "spade", color = paper, back = false) => group(`translate(${x} ${y}) rotate(${angle})`,
  path("M-24 -36 20 -36 25 -31 25 33 20 38 -24 38 -29 33 -29 -31Z", ink, ink, 3)
  + path("M-26 -40 18 -40 23 -35 23 29 18 34 -26 34 -31 29 -31 -35Z", color)
  + rect(-25, -34, 42, 62, "none", color === paper ? "#d4c5a1" : paper, 1.5, 1)
  + (back ? path("M-4 -24 11 -2 -4 19 -19 -2Z", "none", paper, 2) + star(-4, -2, 8, paper)
    : suit(type, -4, -1, .73, type === "heart" || type === "diamond" ? red : type === "club" ? "#368165" : ink)
      + suit(type, -18, -25, .19, type === "heart" || type === "diamond" ? red : ink)
      + suit(type, 10, 19, .19, type === "heart" || type === "diamond" ? red : ink)));
const fan = () => shadow() + card(40, 66, -20, "heart") + card(66, 60, 0, "spade") + card(91, 69, 19, "diamond");
const coin = (x, y, r = 18) => circle(x + 1, y + 3, r, "#ae7835") + circle(x, y, r, gold)
  + circle(x, y, r - 5, "none", "#fff0b4", 2) + suit("diamond", x, y, r / 42, "#9d652d");
const coins = (count = 3) => shadow() + Array.from({ length: count }, (_, i) => {
  const x = 28 + (i % 3) * 33, y = 100 - Math.floor(i / 3) * 16;
  return coin(x, y, 19);
}).join("") + star(99, 31, 8) + star(28, 35, 5);
const walletCoins = () => coin(78, 72, 27) + coin(45, 58, 30);
// Foil crimp, folded side, embossed seal, and a card-shaped window read at dock size.
const pack = (color = purple, emblem = "spade", ribbon = gold) => shadow()
  + group("rotate(-6 64 64)",
    path("M28 17H89L102 28V108L91 118H28Z", ink)
    + path("M89 22 99 29V105L89 113Z", color)
    + path("M25 12H86L91 17V109L86 114H25L20 109V17Z", color)
    + path("M25 13H86V25H25ZM25 101H86V113H25Z", paper, ink, 2)
    + Array.from({ length: 8 }, (_, i) => path(`M${28 + i * 8} 14V23M${28 + i * 8} 103V111`, "none", color, 2)).join("")
    + path("M27 30H84V96H27Z", "none", paper, 2)
    + path("M29 31H82V44H29Z", ink, "none")
    + path("M36 37H48M62 37H75", "none", ribbon, 2)
    + star(55, 37, 4, paper)
    + group("translate(55 70) rotate(10)", rect(-19, -22, 38, 46, paper, ink, 2, 1)
      + rect(-15, -18, 30, 38, "none", color, 1, 0) + suit(emblem, 0, 0, .65, color))
    + path("M24 26V99M88 29V99", "none", ribbon, 2)
    + path("M91 36 97 40M91 87 97 91", "none", paper, 2))
  + star(109, 22, 7, ribbon) + star(12, 86, 4, paper);
const chest = () => shadow() + coin(37, 54, 18) + coin(63, 45, 20) + coin(89, 54, 18)
  + path("M18 59 26 51H104L112 59V104L104 112H26L18 104Z", "#508e78")
  + path("M19 73H111V86H19Z", gold) + rect(28, 60, 10, 49, gold) + rect(92, 60, 10, 49, gold)
  + rect(52, 73, 25, 21, paper) + circle(64, 82, 3, ink, ink, 1) + star(109, 24, 8);
const shield = () => shadow() + path("M64 14 105 30 102 76 90 95 64 115 38 95 26 76 23 30Z", gold)
  + path("M64 24 95 36 92 72 83 88 64 103 45 88 36 72 33 36Z", green)
  + check(64, 60, 1.25) + star(109, 19, 6, paper);
const trophy = () => shadow() + path("M28 34H12V51L20 64 36 68M100 34H116V51L108 64 92 68", "none", gold, 8)
  + path("M32 22H96V53L86 74 70 84V99H86V112H42V99H58V84L42 74 32 53Z", gold)
  + path("M42 28V51L49 64", "none", paper, 5) + suit("spade", 65, 50, .68, ink)
  + path("M44 106H84", "none", paper, 3);
const crown = () => shadow() + path("M18 38 43 54 64 22 85 54 110 38 99 96H29Z", gold)
  + rect(27, 90, 74, 20, gold) + path("M34 100H94", "none", paper, 3)
  + suit("diamond", 64, 71, .51, red) + circle(18, 35, 6, paper) + circle(64, 20, 6, paper) + circle(110, 35, 6, paper);
const clock = () => shadow() + rect(53, 10, 22, 12, gold) + path("M91 26 100 17", "none", gold, 8)
  + circle(64, 69, 42, blue) + circle(64, 69, 33, paper)
  + path("M64 45V70L82 82", "none", ink, 5) + circle(64, 69, 4, red, "none")
  + path("M64 40V43M35 69H39M64 95V99M89 69H93", "none", "#9a9789", 2);
const calendar = () => shadow() + rect(24, 22, 82, 87, paper)
  + rect(24, 22, 82, 24, red) + path("M44 14V30M84 14V30", "none", gold, 7)
  + suit("diamond", 65, 76, .79, gold) + path("M35 58H42M88 58H95M35 93H42M88 93H95", "none", ink, 3);
const avatar = () => shadow() + card(66, 68, 0, "spade", paper, true)
  + circle(64, 49, 16, gold) + path("M37 92V82L48 69H80L91 82V92Z", blue);
const lock = () => path("M43 55V38C43 10 85 10 85 38V55", "none", paper, 10)
  + rect(30, 51, 68, 57, "#91a4af") + circle(64, 76, 7, ink) + path("M64 78V91", "none", ink, 6);
const gear = () => path("M53 15H75L79 29 89 35 103 32 115 51 105 62V73L115 84 103 103 89 100 79 106 75 119H53L49 106 39 100 25 103 13 84 23 73V62L13 51 25 32 39 35 49 29Z", gold)
  + circle(64, 67, 25, paper) + circle(64, 67, 13, ink);
const book = () => shadow() + path("M18 23H54L64 29 74 23H110V104H75L64 111 53 104H18Z", paper)
  + path("M64 31V101", "none", "#c6b897", 3) + suit("spade", 41, 57, .65, ink)
  + path("M78 47H99M78 58H99M78 69H94M29 84H52M78 84H99", "none", "#b8a782", 3);
const arrow = () => path("M67 20 20 64 67 108V83H109V45H67Z", paper) + path("M63 38 35 64 63 88", "none", gold, 4);
const play = () => circle(64, 64, 44, gold) + circle(64, 64, 35, "none", paper, 2) + path("M53 40 88 64 53 88Z", ink, ink, 3);
const vault = () => shadow() + rect(17, 20, 94, 92, blue) + rect(27, 30, 74, 72, paper)
  + circle(64, 64, 23, "#dde3d5") + path("M49 49 79 79M79 49 49 79M64 44V84M44 64H84", "none", ink, 4)
  + circle(64, 64, 8, gold) + rect(93, 42, 13, 12, gold, ink, 3) + rect(93, 77, 13, 12, gold, ink, 3);
const arcade = () => shadow() + path("M34 12H94L101 21V70L113 91V112H18V91L29 70V21Z", purple)
  + rect(37, 27, 56, 39, ink, paper, 2) + bolt(66, 46, .4)
  + path("M29 77H100L108 93H22Z", paper) + path("M42 87V76", "none", ink, 5) + circle(42, 75, 6, red, ink, 2)
  + circle(80, 86, 4, green, ink, 2) + circle(94, 86, 4, gold, ink, 2) + path("M44 103H85", "none", ink, 4);
const duel = () => shadow() + card(37, 65, -17, "spade", blue, true) + card(97, 65, 17, "heart", red, true)
  + bolt(65, 64, .95, gold) + star(16, 20, 6, paper) + star(111, 107, 5, paper);
const pot = (color = green, emblem = "spade", state = "ready") => shadow()
  + (state === "locked" ? "" : card(46, 42, -17, "heart") + card(86, 39, 16, "spade"))
  + path("M26 52H12V73L21 85H35M102 52H116V73L107 85H93", "none", gold, 7)
  + path("M28 47H100V77L91 100 77 111H51L37 100 28 77Z", color)
  + path("M34 55V75L41 91", "none", paper, 4)
  + path("M33 96 47 105H81L94 96 89 108 78 117H50L39 108Z", gold)
  + rect(22, 43, 84, 14, gold) + path("M29 48H99", "none", paper, 3)
  + (state === "locked" ? group("translate(39 62) scale(.4)", lock())
    : state === "complete" ? check(66, 80, .9)
    : emblem === "bolt" ? bolt(65, 80, .43)
    : emblem === "plus" ? path("M65 69V91M54 80H76", "none", paper, 5)
    : suit(emblem, 65, 79, .58, paper));
const collection = () => shadow() + card(43, 47, -12, "heart") + card(86, 47, 12, "spade")
  + path("M18 62H51L59 71H110V109H18Z", blue) + path("M24 80H103V102H24Z", "none", paper, 2) + suit("club", 65, 92, .4, paper);
const retry = () => path("M98 51C88 13 31 15 21 55M20 31V58H47M30 79C42 117 98 110 108 70M82 70H109V97", "none", green, 10)
  + suit("diamond", 64, 65, .65, gold);

function atlas(cells) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><title>Card Crunch — code-drawn card-table illustrations</title>${cells.map((art, i) => `<svg x="${i % 4 * 128}" y="${Math.floor(i / 4) * 128}" width="128" height="128" viewBox="0 0 128 128">${art}</svg>`).join("")}</svg>\n`;
}

export async function generateUIArt() {
  await mkdir(output, { recursive: true });
  const atlases = {
    "shell-ui-atlas.svg": [pack(), collection(), fan(), trophy(), avatar(), group("translate(6 0) scale(.9)", gear()),
      path("M45 22H22V45M83 22H106V45M22 83V106H45M83 106H106V83", "none", paper, 9), trophy(), duel(), arcade(), calendar(), crown(), clock(), bolt(), retry(), shield()],
    "pot-journey-atlas.svg": [pot(), pot("#789099", "spade", "locked"), pot(green), pot(gold, "spade", "complete"),
      pot(red, "heart"), pot("#cb9980", "diamond"), pot(green, "club"), pot(blue, "spade"),
      pot(blue, "bolt"), pot(purple, "plus"), pot(green, "diamond"), pot("#a99968", "club"),
      pot(gold, "diamond"), pot(purple, "spade"), pot(red), pot(gold)],
    "game-controls-atlas.svg": [walletCoins(), suit("heart", 64, 64, 2.1, red), clock(), bolt(), vault(),
      card(65, 67, -8) + bolt(81, 72, .7), circle(64, 64, 44, purple) + path("M46 46 82 82M82 46 46 82", "none", paper, 9), book(),
      arrow(), path("M14 61 64 17 114 61H101V112H27V61Z", paper) + rect(51, 74, 26, 38, green), play(), lock(),
      pack(green), pack(purple), chest(), avatar() + check(98, 96, .6, green)],
    "store-items.svg": [pack(purple), pack(gold), card(43, 60, -17, "heart", red, true) + card(85, 69, 13, "heart", "#f0b4d5", true), chest(),
      shield(), coins(5), pack("#3d536b"), pack(red, "heart"), pack(gold, "diamond"), pack(purple, "diamond", blue),
      bolt(64, 70, 1.15, red) + star(32, 34, 8) + star(99, 85, 9, gold), card(67, 66, -12, "diamond", blue, true),
      coins(3), coins(6), chest(), coins(12)]
  };
  await Promise.all(Object.entries(atlases).map(async ([name, cells]) => {
    const file = resolve(output, name);
    const content = atlas(cells);
    const existing = await readFile(file, "utf8").catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return null;
    });
    if (existing !== content) await writeFile(file, content, "utf8");
  }));
  return Object.keys(atlases);
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  console.log(`Drew ${(await generateUIArt()).length} SVG atlases from code.`);
}
