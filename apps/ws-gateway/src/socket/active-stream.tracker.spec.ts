import { ActiveStreamTracker } from './active-stream.tracker';

describe('ActiveStreamTracker', () => {
  let tracker: ActiveStreamTracker;

  beforeEach(() => {
    tracker = new ActiveStreamTracker();
  });

  it('tracks a stream against its conversation', () => {
    tracker.track('s1', 'c1');
    expect(tracker.getActiveStreams('c1')).toEqual(['s1']);
  });

  it('tracks multiple streams for one conversation', () => {
    tracker.track('s1', 'c1');
    tracker.track('s2', 'c1');
    expect(tracker.getActiveStreams('c1').sort()).toEqual(['s1', 's2']);
  });

  it('track is idempotent', () => {
    tracker.track('s1', 'c1');
    tracker.track('s1', 'c1');
    expect(tracker.getActiveStreams('c1')).toEqual(['s1']);
  });

  it('complete removes a stream and cleans up empty conversations', () => {
    tracker.track('s1', 'c1');
    tracker.complete('s1');
    expect(tracker.getActiveStreams('c1')).toEqual([]);
  });

  it('complete leaves other streams of the same conversation intact', () => {
    tracker.track('s1', 'c1');
    tracker.track('s2', 'c1');
    tracker.complete('s1');
    expect(tracker.getActiveStreams('c1')).toEqual(['s2']);
  });

  it('complete is a no-op for an unknown stream', () => {
    expect(() => tracker.complete('nope')).not.toThrow();
  });

  it('getActiveStreams returns empty array for an unknown conversation', () => {
    expect(tracker.getActiveStreams('unknown')).toEqual([]);
  });

  it('isolates streams across conversations', () => {
    tracker.track('s1', 'c1');
    tracker.track('s2', 'c2');
    expect(tracker.getActiveStreams('c1')).toEqual(['s1']);
    expect(tracker.getActiveStreams('c2')).toEqual(['s2']);
  });
});
