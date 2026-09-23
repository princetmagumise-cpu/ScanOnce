export interface Tool {
  id: string;
  title: string;
  blurb: string;
  group: "Scan & create" | "Convert" | "Organize" | "Optimize & fix" | "Security";
  icon: string; // SVG path data for a 24×24 stroke icon
  render: (root: HTMLElement) => void;
}
