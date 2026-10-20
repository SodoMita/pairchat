export function isCanvasEnabled() {
  const value = process.env.CANVAS_ENABLED;
  if (value === "0" || value === "false" || value === "off") return false;
  return true;
}
