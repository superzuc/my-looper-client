// Loop length as { value, unit }: whole bars when possible, otherwise beats
export function formatLength(beats, tsNum) {
  if (tsNum && beats >= tsNum && Math.abs(beats / tsNum - Math.round(beats / tsNum)) < 1e-6) {
    return { value: Math.round(beats / tsNum), unit: 'bar' };
  }
  const v = Math.abs(beats - Math.round(beats)) < 1e-6 ? Math.round(beats) : beats.toFixed(1);
  return { value: v, unit: 'beat' };
}
