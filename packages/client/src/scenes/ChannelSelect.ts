/**
 * ChannelSelectScene — thin Phaser controller for the channel picker.
 *
 * The window itself is rendered by the React overlay
 * (`ui/ChannelSelectPanel.tsx`) from the shared kit. This scene is now a thin
 * bridge: it fetches the channel list from the server's `/channels` HTTP
 * endpoint, publishes a plain {@link ChannelSelectSnapshot} into the zustand
 * bridge store, registers join/close actions, and tears everything down on
 * close.
 *
 * Shown as a Phaser overlay scene (launched via
 * `this.scene.launch("channelSelect")`). It communicates the picked channel to
 * MapScene via the shared registry — exactly as before:
 *   - "channelSelectTarget" (number) — set when the player picks a channel.
 *   - "channelSelectOpen" (boolean) — true while the overlay is visible.
 */
import Phaser from "phaser";
import { BACKEND_URL, getCurrentChannel } from "../backend";
import { uiStore } from "../ui/store";
import type { ChannelEntry, ChannelSelectSnapshot } from "../ui/store";

/** Registry keys shared with MapScene. */
const CHANNEL_SELECT_TARGET_KEY = "channelSelectTarget";
const CHANNEL_SELECT_OPEN_KEY = "channelSelectOpen";

export class ChannelSelectScene extends Phaser.Scene {
  private channels: ChannelEntry[] = [];
  private currentChannel = 0;
  private loaded = false;
  private destroyed = false;

  constructor() {
    super("channelSelect");
  }

  create(): void {
    this.destroyed = false;
    this.loaded = false;
    this.channels = [];
    this.currentChannel = getCurrentChannel();

    // Register the React-overlay bridge actions for the picker.
    uiStore.getState().setChannelSelectActions({
      join: (channel: number) => this.join(channel),
      close: () => this.close(),
    });
    this.publish();
    uiStore.getState().setChannelSelectOpen(true);
    this.registry.set(CHANNEL_SELECT_OPEN_KEY, true);

    // ESC also closes the picker.
    this.input.keyboard?.on("keydown-ESC", this.close, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.teardown, this);

    void this.fetchChannels();
  }

  private async fetchChannels(): Promise<void> {
    try {
      const httpBase = BACKEND_URL.replace(/^ws/, "http").replace(/\/$/, "");
      const mapId = this.registry.get("mapId") ?? "meadowfield";
      const resp = await fetch(`${httpBase}/channels?mapId=${mapId}`);
      const data = (await resp.json()) as { channels: ChannelEntry[] };
      if (this.destroyed) return;
      this.channels = data.channels ?? [];
    } catch (err) {
      console.error("[ChannelSelect] failed to fetch channels:", err);
      if (this.destroyed) return;
      // Fallback: just the current channel.
      this.channels = [{ channel: this.currentChannel, playerCount: 0 }];
    }
    this.currentChannel = getCurrentChannel();
    this.loaded = true;
    this.publish();
  }

  private publish(): void {
    const snapshot: ChannelSelectSnapshot = {
      channels: this.channels,
      currentChannel: this.currentChannel,
      loaded: this.loaded,
    };
    uiStore.getState().setChannelSelect(snapshot);
  }

  /** Pick a channel: hand the target to MapScene (existing CHANNEL_SWITCH flow). */
  private join(channel: number): void {
    if (channel === this.currentChannel) return;
    this.registry.set(CHANNEL_SELECT_TARGET_KEY, channel);
    this.close();
  }

  private close(): void {
    this.scene.stop("channelSelect");
  }

  private teardown(): void {
    this.destroyed = true;
    this.input.keyboard?.off("keydown-ESC", this.close, this);
    this.registry.set(CHANNEL_SELECT_OPEN_KEY, false);
    uiStore.getState().setChannelSelectOpen(false);
    uiStore.getState().setChannelSelectActions(null);
  }
}
