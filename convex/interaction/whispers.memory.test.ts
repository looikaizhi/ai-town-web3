import { mapImportance } from './whispers';

describe('mapImportance', () => {
  it('maps quadratic weight to the existing 0..9 importance scale', () => {
    expect(mapImportance(0)).toBe(0);
    expect(mapImportance(1000000)).toBe(9); // huge weight clamps to 9
    expect(mapImportance(31.6)).toBeGreaterThanOrEqual(1); // ~sqrt(1000)
    expect(mapImportance(31.6)).toBeLessThanOrEqual(9);
  });
});
