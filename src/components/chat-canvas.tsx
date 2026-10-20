"use client";

import type { RoomSnapshot } from "@/lib/chat";
import {
  CANVAS_BRUSHES,
  CANVAS_HEIGHT,
  CANVAS_MAX_POINTS,
  CANVAS_MAX_STROKES,
  CANVAS_PROTOCOL,
  CANVAS_SIZES,
  CANVAS_WIDTH,
  decryptCanvasEvent,
  encryptCanvasEvent,
  isCanvasEnvelope,
  isCompatibleInvite,
  signCanvasEnvelope,
  verifyCanvasEnvelope,
  type CanvasEnvelope,
  type CanvasStroke,
} from "@/lib/canvas";
import { serializeSigningKey } from "@/lib/e2ee";
import type { ConversationEncryption } from "@/lib/local-chats";
import type { TranslationKey } from "@/lib/i18n";
import { Eraser, Eye, EyeOff, Pencil, RotateCcw, Sparkles, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type Translator = (key: TranslationKey) => string;
type Status = "idle" | "inviting" | "invited" | "active";

function drawStroke(ctx: CanvasRenderingContext2D, stroke: CanvasStroke) {
  if (stroke.points.length === 0) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = stroke.size;
  ctx.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
  ctx.strokeStyle = stroke.color;
  ctx.beginPath();
  ctx.moveTo(stroke.points[0].x * CANVAS_WIDTH, stroke.points[0].y * CANVAS_HEIGHT);
  for (const point of stroke.points.slice(1)) {
    ctx.lineTo(point.x * CANVAS_WIDTH, point.y * CANVAS_HEIGHT);
  }
  if (stroke.points.length === 1) {
    ctx.lineTo(stroke.points[0].x * CANVAS_WIDTH + 0.01, stroke.points[0].y * CANVAS_HEIGHT);
  }
  ctx.stroke();
  ctx.restore();
}

function redraw(canvas: HTMLCanvasElement | null, strokes: CanvasStroke[]) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  for (const stroke of strokes) drawStroke(ctx, stroke);
}

export default function ChatCanvas({
  room,
  clientId,
  encryption,
  queue,
  t,
}: {
  room: RoomSnapshot;
  clientId: string;
  encryption?: ConversationEncryption;
  queue: CanvasEnvelope[];
  t: Translator;
}) {
  const [status, setStatusState] = useState<Status>("idle");
  const [hidden, setHidden] = useState(false);
  const [peerAskedReset, setPeerAskedReset] = useState<number | null>(null);
  const [color, setColor] = useState<string>(CANVAS_BRUSHES[0]);
  const [size, setSize] = useState<number>(CANVAS_SIZES[1]);
  const [tool, setTool] = useState<"brush" | "eraser">("brush");

  const statusRef = useRef<Status>("idle");
  const sessionId = useRef("");
  const seq = useRef(0);
  const boardGeneration = useRef(0);
  const lastPeerSeq = useRef(-1);
  const lastOwnSeq = useRef(-1);
  const ownStrokes = useRef<CanvasStroke[]>([]);
  const peerStrokes = useRef<CanvasStroke[]>([]);
  const drawing = useRef<CanvasStroke | null>(null);
  const ownCanvas = useRef<HTMLCanvasElement>(null);
  const peerCanvas = useRef<HTMLCanvasElement>(null);
  const lastInviteSentAt = useRef(0);
  const lastInviteRecvAt = useRef(0);
  const seenIds = useRef(new Set<string>());
  const queueIndex = useRef(0);
  const ingestChain = useRef<Promise<void>>(Promise.resolve());

  const mineFirst = room.participantPublicId < (room.partnerPublicId ?? "\uffff");

  const setStatus = useCallback((next: Status) => {
    statusRef.current = next;
    setStatusState(next);
  }, []);

  const resetLocal = useCallback(() => {
    sessionId.current = "";
    seq.current = 0;
    boardGeneration.current = 0;
    lastPeerSeq.current = -1;
    lastOwnSeq.current = -1;
    ownStrokes.current = [];
    peerStrokes.current = [];
    drawing.current = null;
    setPeerAskedReset(null);
    setStatus("idle");
    setHidden(false);
    redraw(ownCanvas.current, []);
    redraw(peerCanvas.current, []);
  }, [setStatus]);

  useEffect(() => {
    if (status === "active" && !hidden) {
      redraw(ownCanvas.current, ownStrokes.current);
      redraw(peerCanvas.current, peerStrokes.current);
    }
  }, [status, hidden]);

  const sendEvent = useCallback(async (event: Parameters<typeof encryptCanvasEvent>[6]) => {
    if (!encryption || !room.partnerPublicId || !clientId) {
      throw new Error("canvas credentials unavailable");
    }
    seq.current += 1;
    const currentSeq = seq.current;
    const unsigned = await encryptCanvasEvent(
      encryption,
      room,
      room.participantPublicId,
      sessionId.current,
      currentSeq,
      boardGeneration.current,
      event,
    );
    const signature = await signCanvasEnvelope(encryption, room.id, unsigned);
    const envelope: CanvasEnvelope = { ...unsigned, signature };
    seenIds.current.add(envelope.id);
    lastOwnSeq.current = Math.max(lastOwnSeq.current, currentSeq);

    const response = await fetch(`/api/rooms/${room.id}/canvas`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${clientId}`,
      },
      cache: "no-store",
      body: JSON.stringify({ envelope }),
    });
    if (!response.ok) throw new Error(`canvas send failed (${response.status})`);
  }, [clientId, encryption, room]);

  const applyEvent = useCallback(async (envelope: CanvasEnvelope) => {
    if (seenIds.current.has(envelope.id)) return;
    seenIds.current.add(envelope.id);

    const fromSelf = envelope.senderPublicId === room.participantPublicId;
    if (!fromSelf && envelope.senderPublicId !== room.partnerPublicId) return;

    const signingKey = fromSelf ? serializeSigningKey(encryption) : room.partnerSigningKey;
    if (!await verifyCanvasEnvelope(signingKey, room.id, envelope)) return;

    try {
      const event = await decryptCanvasEvent(encryption, room, envelope);

      if (fromSelf) {
        if (event.type === "invite") {
          if (!isCompatibleInvite(event)) return;
          sessionId.current = envelope.sessionId;
          seq.current = Math.max(seq.current, envelope.seq);
          lastOwnSeq.current = envelope.seq;
          lastPeerSeq.current = -1;
          boardGeneration.current = envelope.boardGeneration;
          ownStrokes.current = [];
          peerStrokes.current = [];
          setStatus("inviting");
          return;
        }
        if (envelope.sessionId !== sessionId.current) return;
        if (envelope.seq <= lastOwnSeq.current) return;
        lastOwnSeq.current = envelope.seq;
        seq.current = Math.max(seq.current, envelope.seq);
        if (event.type === "accept") {
          setStatus("active");
          return;
        }
        if (event.type === "decline" || event.type === "disable") {
          resetLocal();
          return;
        }
        if (statusRef.current !== "active") return;
        if (envelope.boardGeneration !== boardGeneration.current) return;
        if (event.type === "stroke") {
          ownStrokes.current = [...ownStrokes.current, {
            tool: event.tool,
            color: event.color,
            size: event.size,
            points: event.points,
          }].slice(-CANVAS_MAX_STROKES);
          redraw(ownCanvas.current, ownStrokes.current);
        } else if (event.type === "undo") {
          ownStrokes.current = ownStrokes.current.slice(0, -1);
          redraw(ownCanvas.current, ownStrokes.current);
        } else if (event.type === "clear-self") {
          ownStrokes.current = [];
          redraw(ownCanvas.current, []);
        } else if (event.type === "reset-approve" && event.generation === boardGeneration.current) {
          boardGeneration.current += 1;
          ownStrokes.current = [];
          peerStrokes.current = [];
          setPeerAskedReset(null);
          redraw(ownCanvas.current, []);
          redraw(peerCanvas.current, []);
        }
        return;
      }

      if (event.type === "invite") {
        if (!isCompatibleInvite(event)) return;
        const now = Date.now();
        if (now - lastInviteRecvAt.current < 1500 && statusRef.current === "invited") return;
        lastInviteRecvAt.current = now;

        // Simultaneous invite from both sides: both users explicitly clicked Draw together!
        if (statusRef.current === "inviting") {
          if (!mineFirst) {
            sessionId.current = envelope.sessionId;
            seq.current = 0;
            lastOwnSeq.current = -1;
            lastPeerSeq.current = envelope.seq;
            boardGeneration.current = envelope.boardGeneration;
          } else {
            lastPeerSeq.current = envelope.seq;
          }
          setStatus("active");
          try {
            await sendEvent({ type: "accept" });
          } catch {
            // Peer will also activate from their side or on reconnect.
          }
          return;
        }

        sessionId.current = envelope.sessionId;
        seq.current = 0;
        lastOwnSeq.current = -1;
        lastPeerSeq.current = envelope.seq;
        boardGeneration.current = envelope.boardGeneration;
        ownStrokes.current = [];
        peerStrokes.current = [];
        setPeerAskedReset(null);
        setStatus("invited");
        return;
      }

      if (envelope.sessionId !== sessionId.current) return;
      if (envelope.seq <= lastPeerSeq.current) return;
      lastPeerSeq.current = envelope.seq;

      if (event.type === "accept" && (statusRef.current === "inviting" || statusRef.current === "invited")) {
        setStatus("active");
        return;
      }
      if (event.type === "decline" || event.type === "disable") {
        resetLocal();
        return;
      }
      if (statusRef.current !== "active") return;
      if (envelope.boardGeneration !== boardGeneration.current) return;

      if (event.type === "stroke") {
        const stroke: CanvasStroke = {
          tool: event.tool === "eraser" ? "eraser" : "brush",
          color: event.color,
          size: Math.min(24, Math.max(1, event.size)),
          points: event.points.slice(0, CANVAS_MAX_POINTS),
        };
        peerStrokes.current = [...peerStrokes.current, stroke].slice(-CANVAS_MAX_STROKES);
        redraw(peerCanvas.current, peerStrokes.current);
      } else if (event.type === "undo") {
        peerStrokes.current = peerStrokes.current.slice(0, -1);
        redraw(peerCanvas.current, peerStrokes.current);
      } else if (event.type === "clear-self") {
        peerStrokes.current = [];
        redraw(peerCanvas.current, []);
      } else if (event.type === "reset-request" && event.generation === boardGeneration.current) {
        setPeerAskedReset(event.generation);
      } else if (event.type === "reset-approve" && event.generation === boardGeneration.current) {
        boardGeneration.current += 1;
        ownStrokes.current = [];
        peerStrokes.current = [];
        setPeerAskedReset(null);
        redraw(ownCanvas.current, []);
        redraw(peerCanvas.current, []);
      }
    } catch {
      // Tampered or undecryptable canvas traffic is dropped without affecting chat.
    }
  }, [encryption, mineFirst, resetLocal, room, sendEvent, setStatus]);

  useEffect(() => {
    if (queue.length < queueIndex.current) {
      queueIndex.current = 0;
    }
    const pending = queue.slice(queueIndex.current);
    queueIndex.current = queue.length;
    for (const item of pending) {
      if (!isCanvasEnvelope(item)) continue;
      ingestChain.current = ingestChain.current.then(() => applyEvent(item));
    }
  }, [applyEvent, queue]);

  useEffect(() => {
    seenIds.current = new Set();
    queueIndex.current = 0;
    resetLocal();
  }, [resetLocal, room.id]);

  const invite = async () => {
    const now = Date.now();
    if (now - lastInviteSentAt.current < 2500) return;
    lastInviteSentAt.current = now;
    sessionId.current = crypto.randomUUID();
    seq.current = 0;
    lastOwnSeq.current = -1;
    boardGeneration.current = 0;
    lastPeerSeq.current = -1;
    ownStrokes.current = [];
    peerStrokes.current = [];
    setPeerAskedReset(null);
    setStatus("inviting");
    try {
      await sendEvent({
        type: "invite",
        protocol: CANVAS_PROTOCOL,
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        units: "normalized",
        brushes: [...CANVAS_BRUSHES],
      });
    } catch {
      resetLocal();
    }
  };

  const accept = async () => {
    setStatus("active");
    try {
      await sendEvent({ type: "accept" });
    } catch {
      resetLocal();
    }
  };

  const decline = async () => {
    try {
      await sendEvent({ type: "decline" });
    } catch {
      // Local close still wins.
    }
    resetLocal();
  };

  const disable = async () => {
    try {
      if (sessionId.current) await sendEvent({ type: "disable" });
    } catch {
      // Leave/disable is local-first.
    }
    resetLocal();
  };

  const requestReset = async () => {
    try {
      await sendEvent({ type: "reset-request", generation: boardGeneration.current });
    } catch {
      // Ignore transient send failure.
    }
  };

  const approveReset = async () => {
    if (peerAskedReset === null || peerAskedReset !== boardGeneration.current) {
      setPeerAskedReset(null);
      return;
    }
    const gen = boardGeneration.current;
    boardGeneration.current += 1;
    ownStrokes.current = [];
    peerStrokes.current = [];
    setPeerAskedReset(null);
    redraw(ownCanvas.current, []);
    redraw(peerCanvas.current, []);
    try {
      seq.current += 1;
      const currentSeq = seq.current;
      const unsigned = await encryptCanvasEvent(
        encryption,
        room,
        room.participantPublicId,
        sessionId.current,
        currentSeq,
        gen,
        { type: "reset-approve", generation: gen },
      );
      const signature = await signCanvasEnvelope(encryption, room.id, unsigned);
      const envelope: CanvasEnvelope = { ...unsigned, signature };
      seenIds.current.add(envelope.id);
      lastOwnSeq.current = Math.max(lastOwnSeq.current, currentSeq);
      await fetch(`/api/rooms/${room.id}/canvas`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${clientId}`,
        },
        cache: "no-store",
        body: JSON.stringify({ envelope }),
      });
    } catch {
      // Local board reset already applied.
    }
  };

  const pointFromEvent = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (statusRef.current !== "active" || hidden) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const startPoint = pointFromEvent(event);
    drawing.current = { tool, color, size, points: [startPoint] };
    redraw(ownCanvas.current, [...ownStrokes.current, drawing.current]);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    drawing.current.points.push(pointFromEvent(event));
    redraw(ownCanvas.current, [...ownStrokes.current, drawing.current]);
  };

  const onPointerUp = async () => {
    const stroke = drawing.current;
    drawing.current = null;
    if (!stroke || stroke.points.length === 0) return;
    let points = stroke.points;
    if (points.length > CANVAS_MAX_POINTS) {
      const stride = Math.ceil(points.length / CANVAS_MAX_POINTS);
      points = points.filter((_, index) => index % stride === 0 || index === points.length - 1).slice(0, CANVAS_MAX_POINTS);
    }
    const next = { ...stroke, points };
    ownStrokes.current = [...ownStrokes.current, next].slice(-CANVAS_MAX_STROKES);
    redraw(ownCanvas.current, ownStrokes.current);
    try {
      await sendEvent({ type: "stroke", tool: next.tool, color: next.color, size: next.size, points: next.points });
    } catch {
      // Keep local stroke even if network blips.
    }
  };

  const undo = async () => {
    ownStrokes.current = ownStrokes.current.slice(0, -1);
    redraw(ownCanvas.current, ownStrokes.current);
    try {
      await sendEvent({ type: "undo" });
    } catch {
      // Local undo still applies.
    }
  };

  const clearMine = async () => {
    ownStrokes.current = [];
    redraw(ownCanvas.current, []);
    try {
      await sendEvent({ type: "clear-self" });
    } catch {
      // Local clear still applies.
    }
  };

  if (status === "idle") {
    return (
      <div className="flex shrink-0 items-center justify-end border-b border-[#ecece7] px-4 py-2 sm:px-6">
        <button
          type="button"
          onClick={() => void invite()}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#e1e3dd] px-3 text-[10px] font-extrabold text-[#59635f] hover:bg-[#f7f7f3]"
        >
          <Pencil size={13} /> {t("canvasDraw")}
        </button>
      </div>
    );
  }

  if (status === "inviting") {
    return (
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#ecece7] bg-[#fafaf7] px-4 py-2 text-[11px] text-[#65716c] sm:px-6">
        <span className="font-semibold">{t("canvasWaiting")}</span>
        <button type="button" onClick={() => void disable()} className="font-extrabold text-[#929995] hover:text-[#27322f]">{t("cancel")}</button>
      </div>
    );
  }

  if (status === "invited") {
    return (
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[#ecece7] bg-[#fff8f4] px-4 py-2 text-[11px] text-[#8a6d63] sm:px-6">
        <span className="font-semibold">{t("canvasInviteCopy")}</span>
        <span className="flex gap-2">
          <button type="button" onClick={() => void accept()} className="rounded-lg bg-[#ff6747] px-3 py-1.5 text-[10px] font-extrabold text-white hover:bg-[#ee5b3d]">{t("canvasAccept")}</button>
          <button type="button" onClick={() => void decline()} className="rounded-lg border border-[#e1e3dd] bg-white px-3 py-1.5 text-[10px] font-extrabold text-[#59635f] hover:bg-[#f7f7f3]">{t("canvasDecline")}</button>
        </span>
      </div>
    );
  }

  return (
    <div className="shrink-0 border-b border-[#ecece7] bg-[#fafaf7]">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 sm:px-6">
        <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#8a918e]">{t("canvasDraw")}</span>
        <div className="flex gap-1">
          {CANVAS_BRUSHES.map((value) => (
            <button
              key={value}
              type="button"
              aria-label={value}
              onClick={() => { setTool("brush"); setColor(value); }}
              className={`h-6 w-6 rounded-full border ${color === value && tool === "brush" ? "border-[#1e2927] scale-110" : "border-white"}`}
              style={{ background: value }}
            />
          ))}
          <button type="button" onClick={() => setTool("eraser")} className={`grid h-6 w-6 place-items-center rounded-full border ${tool === "eraser" ? "border-[#1e2927] bg-white" : "border-[#e1e3dd] bg-white"}`} aria-label="Eraser">
            <Eraser size={12} />
          </button>
        </div>
        <div className="flex gap-1">
          {CANVAS_SIZES.map((value) => (
            <button key={value} type="button" onClick={() => setSize(value)} className={`h-6 rounded-full border px-2 text-[9px] font-bold ${size === value ? "border-[#ff6747] text-[#ff6747]" : "border-[#e1e3dd] text-[#65716c]"}`}>
              {value}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => void undo()} className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[10px] font-extrabold text-[#59635f] hover:bg-white"><RotateCcw size={12} /> {t("canvasUndo")}</button>
        <button type="button" onClick={() => void clearMine()} className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[10px] font-extrabold text-[#59635f] hover:bg-white"><Trash2 size={12} /> {t("canvasClear")}</button>
        <button type="button" onClick={() => void requestReset()} className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[10px] font-extrabold text-[#59635f] hover:bg-white"><Sparkles size={12} /> {t("canvasReset")}</button>
        <button type="button" onClick={() => setHidden((value) => !value)} className="ms-auto inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[10px] font-extrabold text-[#59635f] hover:bg-white">
          {hidden ? <Eye size={12} /> : <EyeOff size={12} />} {hidden ? t("canvasShow") : t("canvasHide")}
        </button>
        <button type="button" onClick={() => void disable()} className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[10px] font-extrabold text-[#c2412a] hover:bg-[#fff0ec]"><X size={12} /> {t("canvasDisable")}</button>
      </div>
      {peerAskedReset !== null && peerAskedReset === boardGeneration.current && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#ecece7] bg-[#fff8f4] px-4 py-1.5 text-[11px] text-[#8a6d63] sm:px-6">
          <span className="font-semibold">{t("canvasResetAsk")}</span>
          <span className="flex gap-2">
            <button type="button" onClick={() => void approveReset()} className="rounded-lg bg-[#ff6747] px-2.5 py-1 text-[10px] font-extrabold text-white">{t("canvasResetApprove")}</button>
            <button type="button" onClick={() => setPeerAskedReset(null)} className="rounded-lg border border-[#e1e3dd] bg-white px-2.5 py-1 text-[10px] font-extrabold text-[#59635f]">{t("canvasDecline")}</button>
          </span>
        </div>
      )}
      {!hidden && (
        <div className="px-3 pb-2 sm:px-6 sm:pb-3">
          <div className="relative mx-auto max-h-[180px] overflow-hidden rounded-xl border border-[#e1e3dd] bg-white sm:max-h-[240px] lg:max-h-[280px]" style={{ aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}` }}>
            <canvas
              ref={mineFirst ? ownCanvas : peerCanvas}
              width={CANVAS_WIDTH}
              height={CANVAS_HEIGHT}
              data-layer="bottom"
              className="pointer-events-none absolute inset-0 h-full w-full"
            />
            <canvas
              ref={mineFirst ? peerCanvas : ownCanvas}
              width={CANVAS_WIDTH}
              height={CANVAS_HEIGHT}
              data-layer="top"
              className="pointer-events-none absolute inset-0 h-full w-full"
            />
            <canvas
              width={CANVAS_WIDTH}
              height={CANVAS_HEIGHT}
              data-layer="input"
              className="absolute inset-0 h-full w-full touch-none"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={() => void onPointerUp()}
              onPointerCancel={() => void onPointerUp()}
            />
          </div>
        </div>
      )}
    </div>
  );
}
