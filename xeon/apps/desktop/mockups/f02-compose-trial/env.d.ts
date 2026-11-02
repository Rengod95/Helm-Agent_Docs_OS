declare module "*.css";
declare module "*.css?inline" {
  const css: string;
  export default css;
}
declare module "*.txt?raw" {
  const text: string;
  export default text;
}
