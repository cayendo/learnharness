export type LiveProcess = { readonly owner: symbol; readonly sessionId: string | undefined; readonly idle: boolean; toolCallIds: string[]; kill(): void };

// Tools usually call back within seconds, but a question tool holds its call until the learner
// answers. Past this, the process is killed and the answer starts a fresh one with a full replay.
// It stays under MCP_TOOL_TIMEOUT so the process is killed before the CLI gives up on its own.
export const LIVE_PROCESS_IDLE_TIMEOUT_MS = 10 * 60_000;

// A finished conversation turn keeps its child for the learner's next message, so the CLI's
// prompt cache (one hour) keeps covering the history. Past this, the next message replays.
export const IDLE_CHAT_TIMEOUT_MS = 55 * 60_000;

// Each idle chat holds a whole CLI process; past this many, the least recently used one closes.
export const MAX_IDLE_CHATS = 3;

/** Test seams (runner.ts's pdfModelOverride idiom). */
export const liveProcessIdleTimeoutMs = { current: LIVE_PROCESS_IDLE_TIMEOUT_MS };
export const idleChatTimeoutMs = { current: IDLE_CHAT_TIMEOUT_MS };

// Each live process mapped to the timer that kills it if pi never calls back.
// Insertion order is recency: re-adding a process moves it to the end.
const liveProcesses = new Map<LiveProcess, NodeJS.Timeout>();

export function addLiveProcess(process: LiveProcess, timeoutMs = liveProcessIdleTimeoutMs.current): void {
	removeLiveProcess(process);
	const timer = setTimeout(() => {
		removeLiveProcess(process);
		process.kill();
	}, timeoutMs);

	timer.unref();

	liveProcesses.set(process, timer);
}

/** Hold a finished conversation turn's process for its chat's next message. */
export function addIdleProcess(process: LiveProcess): void {
	for (const other of liveProcesses.keys()) {
		if (other !== process && other.idle && other.owner === process.owner && other.sessionId === process.sessionId) other.kill();
	}

	addLiveProcess(process, idleChatTimeoutMs.current);

	const idle = [...liveProcesses.keys()].filter((other) => other.idle);
	for (const oldest of idle.slice(0, Math.max(0, idle.length - MAX_IDLE_CHATS))) oldest.kill();
}

function hasSameIds(ids: string[], otherIds: string[]): boolean {
	return ids.length === otherIds.length && new Set(otherIds).size === otherIds.length && ids.every((id) => otherIds.includes(id));
}

export function getLiveProcess(toolCallIds: string[], owner: symbol, sessionId: string | undefined): LiveProcess | null {
	if (!sessionId || toolCallIds.length === 0) return null;

	for (const process of liveProcesses.keys()) {
		if (process.owner === owner && process.sessionId === sessionId && hasSameIds(process.toolCallIds, toolCallIds)) return process;
	}

	return null;
}

export function getIdleProcess(owner: symbol, sessionId: string | undefined): LiveProcess | null {
	if (!sessionId) return null;

	for (const process of liveProcesses.keys()) {
		if (process.idle && process.owner === owner && process.sessionId === sessionId) return process;
	}

	return null;
}

export function removeLiveProcess(process: LiveProcess): void {
	clearTimeout(liveProcesses.get(process));
	liveProcesses.delete(process);
}
