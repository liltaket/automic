import { afterEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { MeetAdapter, readMeetState } from "../extension/meet.js";

const windows: JSDOM[] = [];

function createMeet(markup: string): Document {
  const dom = new JSDOM(`<!doctype html><html><body>${markup}</body></html>`);
  windows.push(dom);
  return dom.window.document;
}

afterEach(() => {
  for (const window of windows.splice(0)) window.window.close();
  vi.restoreAllMocks();
});

describe("Meet DOM adapter", () => {
  it("recognizes English meeting controls and only clicks the unique muted control", () => {
    const document = createMeet(`
      <button aria-label="Leave call">Leave call</button>
      <button aria-label="Turn on microphone" title="Turn on microphone">Turn on microphone</button>
      <section role="log" aria-label="Live captions">
        <div role="listitem"><span data-speaker="Anna">Anna</span><span data-caption-text>Bruno, what do you think?</span></div>
      </section>
    `);
    const unmute = document.querySelector<HTMLButtonElement>(
      '[aria-label="Turn on microphone"]',
    )!;
    const click = vi.spyOn(unmute, "click");

    expect(readMeetState(document)).toEqual({ inMeeting: true, muted: true });
    const adapter = new MeetAdapter({
      document,
      onCaption: () => undefined,
      onState: () => undefined,
    });
    expect(adapter.unmute()).toBe(true);
    expect(click).toHaveBeenCalledOnce();
  });

  it("recognizes Swedish Meet labels", () => {
    const document = createMeet(`
      <button aria-label="Lämna samtalet">Lämna samtalet</button>
      <button aria-label="Slå på mikrofon">Slå på mikrofon</button>
      <section role="log" aria-label="Undertexter live"></section>
    `);
    expect(readMeetState(document)).toEqual({ inMeeting: true, muted: true });
  });

  it("fails closed in the pre-join lobby even if a microphone control is visible", () => {
    const document = createMeet(`
      <button aria-label="Join now">Join now</button>
      <button aria-label="Turn on microphone">Turn on microphone</button>
      <section role="log" aria-label="Live captions"><div role="listitem">Bruno?</div></section>
    `);
    const unmute = document.querySelector<HTMLButtonElement>(
      '[aria-label="Turn on microphone"]',
    )!;
    const click = vi.spyOn(unmute, "click");
    const captions: unknown[] = [];
    const adapter = new MeetAdapter({
      document,
      onCaption: (caption) => captions.push(caption),
      onState: () => undefined,
    });

    expect(readMeetState(document)).toEqual({ inMeeting: false, muted: null });
    adapter.refresh();
    expect(adapter.unmute()).toBe(false);
    expect(captions).toEqual([]);
    expect(click).not.toHaveBeenCalled();
  });

  it("does not click when mute state is unknown, ambiguous, or already unmuted", () => {
    const unknown = createMeet(`
      <button aria-label="Leave call">Leave call</button>
      <button aria-label="Microphone">Microphone</button>
    `);
    const unknownControl = unknown.querySelector<HTMLButtonElement>(
      '[aria-label="Microphone"]',
    )!;
    const unknownClick = vi.spyOn(unknownControl, "click");
    const unknownAdapter = new MeetAdapter({
      document: unknown,
      onCaption: () => undefined,
      onState: () => undefined,
    });
    expect(readMeetState(unknown)).toEqual({ inMeeting: true, muted: null });
    expect(unknownAdapter.unmute()).toBe(false);
    expect(unknownClick).not.toHaveBeenCalled();

    const duplicate = createMeet(`
      <button aria-label="Leave call">Leave call</button>
      <button aria-label="Unmute microphone">Unmute</button>
      <button aria-label="Unmute microphone">Unmute duplicate</button>
    `);
    const duplicateButtons = duplicate.querySelectorAll<HTMLButtonElement>(
      '[aria-label="Unmute microphone"]',
    );
    const duplicateClicks = [...duplicateButtons].map((button) =>
      vi.spyOn(button, "click"),
    );
    const duplicateAdapter = new MeetAdapter({
      document: duplicate,
      onCaption: () => undefined,
      onState: () => undefined,
    });
    expect(readMeetState(duplicate)).toEqual({ inMeeting: true, muted: null });
    expect(duplicateAdapter.unmute()).toBe(false);
    for (const click of duplicateClicks) expect(click).not.toHaveBeenCalled();

    const alreadyOn = createMeet(`
      <button aria-label="Leave call">Leave call</button>
      <button aria-label="Turn off microphone">Turn off microphone</button>
    `);
    const activeControl = alreadyOn.querySelector<HTMLButtonElement>(
      '[aria-label="Turn off microphone"]',
    )!;
    const activeClick = vi.spyOn(activeControl, "click");
    const activeAdapter = new MeetAdapter({
      document: alreadyOn,
      onCaption: () => undefined,
      onState: () => undefined,
    });
    expect(readMeetState(alreadyOn)).toEqual({ inMeeting: true, muted: false });
    expect(activeAdapter.unmute()).toBe(false);
    expect(activeClick).not.toHaveBeenCalled();
  });

  it("ignores disabled and hidden mute controls", () => {
    const document = createMeet(`
      <button aria-label="Leave call">Leave call</button>
      <button aria-label="Turn on microphone" disabled>Turn on microphone</button>
      <button aria-label="Turn on microphone" aria-hidden="true">Hidden duplicate</button>
    `);
    const controls = document.querySelectorAll<HTMLButtonElement>(
      '[aria-label="Turn on microphone"]',
    );
    const clicks = [...controls].map((button) => vi.spyOn(button, "click"));
    const adapter = new MeetAdapter({
      document,
      onCaption: () => undefined,
      onState: () => undefined,
    });

    expect(readMeetState(document)).toEqual({ inMeeting: true, muted: null });
    expect(adapter.unmute()).toBe(false);
    for (const click of clicks) expect(click).not.toHaveBeenCalled();
  });

  it("debounces caption revisions, reuses the row id, and deduplicates unchanged data", async () => {
    const document = createMeet(`
      <button aria-label="Leave call">Leave call</button>
      <button aria-label="Turn on microphone">Turn on microphone</button>
      <section role="log" aria-label="Live captions">
        <div role="listitem"><span data-speaker="Anna">Anna</span><span data-caption-text>Bruno</span></div>
      </section>
    `);
    const received: Array<{ id: string; speaker?: string; text: string }> = [];
    const adapter = new MeetAdapter({
      document,
      onCaption: (caption) => received.push(caption),
      onState: () => undefined,
      debounceMs: 25,
    });
    adapter.start();
    expect(received).toHaveLength(0);
    adapter.refresh();
    expect(received).toHaveLength(0);

    document.querySelector("[data-caption-text]")!.textContent =
      "Bruno, vad tycker du?";
    await new Promise((resolve) => setTimeout(resolve, 70));
    expect(received).toHaveLength(1);
    const firstId = received[0]!.id;
    expect(received[0]).toMatchObject({
      speaker: "Anna",
      text: "Bruno, vad tycker du?",
    });

    document
      .querySelector('[role="listitem"]')!
      .after(document.querySelector('[role="listitem"]')!.cloneNode(true));
    await new Promise((resolve) => setTimeout(resolve, 70));
    expect(received).toHaveLength(1);

    adapter.refresh();
    expect(received).toHaveLength(1);
    expect(received[0]!.id).toBe(firstId);
    adapter.stop();
  });

  it("clears meeting state after the leave-call control disappears", () => {
    const document = createMeet(`
      <button aria-label="Leave call">Leave call</button>
      <button aria-label="Turn on microphone">Turn on microphone</button>
      <section role="log" aria-label="Live captions"></section>
    `);
    const states: Array<{ inMeeting: boolean; muted: boolean | null }> = [];
    const adapter = new MeetAdapter({
      document,
      onCaption: () => undefined,
      onState: (state) => states.push(state),
    });
    adapter.refresh();
    document.querySelector('[aria-label="Leave call"]')!.remove();
    adapter.refresh();
    expect(states).toEqual([
      { inMeeting: true, muted: true },
      { inMeeting: false, muted: null },
    ]);
  });
});
