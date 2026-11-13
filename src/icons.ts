// Dot-matrix icons in the spirit of Nothing's glyphs: each is a 7×7 grid where
// "#" is a lit dot. Drawn as SVG circles in currentColor.

const GLYPHS = {
  mic: ["..###..", "..###..", "#.###.#", "#.###.#", ".#...#.", "...#...", "..###.."],
  notes: ["#######", ".......", "#####..", ".......", "#######", ".......", "####..."],
  todo: [".......", "......#", ".....#.", "#...#..", ".#.#...", "..#....", "......."],
  calendar: [".#...#.", "#######", "#.....#", "#.#.#.#", "#.....#", "#.#.#.#", "#######"],
  settings: ["#..#..#", ".#####.", ".##.##.", "###.###", ".##.##.", ".#####.", "#..#..#"],
  image: ["#######", "#.....#", "#...#.#", "#.....#", "#.#...#", "##.#.##", "#######"],
  camera: [".......", "..###..", "#######", "#..#..#", "#.###.#", "#..#..#", "#######"],
  plus: ["...#...", "...#...", "...#...", "#######", "...#...", "...#...", "...#..."],
  folder: [".......", "###....", "#######", "#.....#", "#.....#", "#.....#", "#######"],
  edit: [".....#.", "....###", "...###.", "..###..", ".###...", "##.....", "#......"],
} as const;

export type IconName = keyof typeof GLYPHS;

export function icon(name: IconName, cls = "icon") {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 7 7");
  svg.setAttribute("class", cls);
  svg.setAttribute("aria-hidden", "true");
  GLYPHS[name].forEach((row, y) =>
    [...row].forEach((c, x) => {
      if (c !== "#") return;
      const dot = document.createElementNS(NS, "circle");
      dot.setAttribute("cx", String(x + 0.5));
      dot.setAttribute("cy", String(y + 0.5));
      dot.setAttribute("r", "0.38");
      svg.appendChild(dot);
    }),
  );
  return svg;
}
