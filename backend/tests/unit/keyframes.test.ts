import { segmentCuts } from '../../src/services/keyframes'

describe('segmentCuts', () => {
  it('cuts at the first keyframe at least 6 s after the previous cut, ends at the duration', () => {
    expect(segmentCuts([0, 2.5, 9.125, 11, 17.417, 21, 29.917, 31.208, 38.833, 44, 46.333, 55.708], 60, 6))
      .toEqual([0, 9.125, 17.417, 29.917, 38.833, 46.333, 55.708, 60])
  })
  it('regular keyframes every 2 s give 6 s segments', () => {
    const kf = Array.from({ length: 30 }, (_, i) => i * 2)
    expect(segmentCuts(kf, 60, 6)).toEqual([0, 6, 12, 18, 24, 30, 36, 42, 48, 54, 60])
  })
  it('never makes a tiny last segment from a keyframe at the very end', () => {
    expect(segmentCuts([0, 6, 11.8], 12, 6)).toEqual([0, 6, 12])
  })
})
