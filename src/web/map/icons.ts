/** Aircraft silhouette (nose up, so icon-rotate = heading) drawn on a canvas at 2x. */
export function aircraftIcon(fill: string, stroke: string): ImageData {
  const size = 64;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  g.translate(size / 2, size / 2);
  g.beginPath();
  g.moveTo(0, -28);
  g.bezierCurveTo(3, -28, 4, -22, 4, -16);
  g.lineTo(4, -6); g.lineTo(28, 6); g.lineTo(28, 11); g.lineTo(4, 5);
  g.lineTo(3, 18); g.lineTo(11, 24); g.lineTo(11, 28); g.lineTo(0, 25);
  g.lineTo(-11, 28); g.lineTo(-11, 24); g.lineTo(-3, 18);
  g.lineTo(-4, 5); g.lineTo(-28, 11); g.lineTo(-28, 6); g.lineTo(-4, -6);
  g.lineTo(-4, -16);
  g.bezierCurveTo(-4, -22, -3, -28, 0, -28);
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = stroke;
  g.stroke();
  return g.getImageData(0, 0, size, size);
}
