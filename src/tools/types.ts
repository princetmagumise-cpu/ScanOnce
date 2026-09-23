export interface Tool {
  id: string;
  title: string;
  blurb: string;
  group: "Scan & create" | "Convert" | "Organize" | "Optimize & fix" | "Security";
  icon: string; // SVG path data for a 24×24 stroke glyph, drawn white on `tint`
  tint: string; // tile colour from Apple's system palette
  render: (root: HTMLElement) => void;
}
