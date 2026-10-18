// esbuild loads bundled SVG icons as text.
declare module "*.svg" {
  const svg: string;
  export default svg;
}
