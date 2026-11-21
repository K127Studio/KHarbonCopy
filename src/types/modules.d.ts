declare module "fontkit" {
  export function create(buffer: Uint8Array, postscriptName?: string | null): any;
}
declare module "clipper-lib" {
  const ClipperLib: any;
  export default ClipperLib;
}
