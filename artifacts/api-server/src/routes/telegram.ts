import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import { Router, type IRouter, type RequestHandler } from "express";
import multer, { MulterError } from "multer";
import { count, desc, eq, gte, ilike, or } from "drizzle-orm";
import {
  DeleteInboxUploadParams,
  GetInboxMediaParams,
  GetInboxQueryParams,
  GetInboxResponse,
  GetInboxStatsResponse,
  GetTelegramStatusResponse,
  SendUploadsBody,
  SendUploadsResponse,
} from "@workspace/api-zod";
import { db, telegramUploadsTable } from "@workspace/db";

const router: IRouter = Router();

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const MAX_BATCH_SIZE = 80 * 1024 * 1024;
const MAX_PHOTO_SIZE = 10 * 1024 * 1024;
const MAX_FILES = 20;
const MAX_CAPTION_LENGTH = 1024;
const VIDEO_EXTENSIONS = new Set([
  ".3gp",
  ".avi",
  ".m4v",
  ".mkv",
  ".mov",
  ".mp4",
  ".mpeg",
  ".mpg",
  ".webm",
]);
const IMAGE_EXTENSIONS = new Set([
  ".avif",
  ".bmp",
  ".gif",
  ".heic",
  ".heif",
  ".jpeg",
  ".jpg",
  ".png",
  ".tif",
  ".tiff",
  ".webp",
]);

function getMediaType(file: Express.Multer.File): "photo" | "video" | null {
  const extension = extname(file.originalname).toLowerCase();
  const mime = file.mimetype.toLowerCase();
  if (mime === "image/svg+xml" || extension === ".svg") return null;
  if (mime.startsWith("video/") || VIDEO_EXTENSIONS.has(extension)) return "video";
  if (mime.startsWith("image/") || IMAGE_EXTENSIONS.has(extension)) return "photo";
  return null;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_FILES,
    fields: 1,
    fieldSize: MAX_CAPTION_LENGTH,
  },
  fileFilter: (_req, file, callback) => {
    if (!getMediaType(file as Express.Multer.File)) {
      callback(new Error("Only image and video files are supported. SVG files are not supported."));
      return;
    }
    callback(null, true);
  },
});

const parseUploadBatch: RequestHandler = (req, res, next) => {
  const contentLength = Number(req.headers["content-length"] ?? 0);
  if (contentLength > MAX_BATCH_SIZE + 1024 * 1024) {
    res.status(413).json({ error: "Keep each batch under 80 MB." });
    return;
  }

  upload.array("files", MAX_FILES)(req, res, (error: unknown) => {
    if (error) {
      if (error instanceof MulterError && error.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({ error: "Each photo or video must be 50 MB or smaller." });
        return;
      }
      if (error instanceof MulterError && error.code === "LIMIT_FILE_COUNT") {
        res.status(400).json({ error: `Choose no more than ${MAX_FILES} photos or videos.` });
        return;
      }
      res.status(400).json({
        error: error instanceof Error ? error.message : "The selected files could not be read.",
      });
      return;
    }
    next();
  });
};

const uploadWindowMs = 60_000;
const uploadLimitPerMinute = 10;
const uploadAttempts = new Map<string, { startedAt: number; count: number }>();
const limitUploadRate: RequestHandler = (req, res, next) => {
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || "unknown";
  let bucket = uploadAttempts.get(key);
  if (!bucket || now - bucket.startedAt >= uploadWindowMs) {
    bucket = { startedAt: now, count: 0 };
    uploadAttempts.set(key, bucket);
  }

  if (uploadAttempts.size > 2_000) {
    for (const [address, attempt] of uploadAttempts) {
      if (now - attempt.startedAt >= uploadWindowMs) uploadAttempts.delete(address);
    }
  }

  if (bucket.count >= uploadLimitPerMinute) {
    res.setHeader("Retry-After", "60");
    res.status(429).json({ error: "Too many upload batches. Try again in a minute." });
    return;
  }

  bucket.count += 1;
  next();
};

function telegramEndpoint(token: string, method: string): string {
  return `https://api.telegram.org/bot${token}/${method}`;
}

type TelegramResult<T> = {
  ok?: boolean;
  result?: T;
  description?: string;
};

async function readTelegramResult<T>(response: Response): Promise<TelegramResult<T>> {
  try {
    return (await response.json()) as TelegramResult<T>;
  } catch {
    return { ok: false, description: "Telegram returned an unreadable response." };
  }
}

async function postTelegramJson<T>(
  token: string,
  method: string,
  values: Record<string, string>,
): Promise<TelegramResult<T>> {
  const response = await fetch(telegramEndpoint(token, method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(values),
    signal: AbortSignal.timeout(12_000),
  });
  return readTelegramResult<T>(response);
}

type TelegramReadiness = {
  configured: boolean;
  chatConfigured: boolean;
  botConnected: boolean;
  destinationAccessible: boolean;
  diagnostic: string | null;
};

async function checkTelegramReadiness(): Promise<TelegramReadiness> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  const status: TelegramReadiness = {
    configured: Boolean(token),
    chatConfigured: Boolean(chatId),
    botConnected: false,
    destinationAccessible: false,
    diagnostic: null,
  };

  if (!token) {
    status.diagnostic = "Add the Telegram bot token in project secrets.";
    return status;
  }

  try {
    const meResponse = await fetch(telegramEndpoint(token, "getMe"), {
      signal: AbortSignal.timeout(12_000),
    });
    const me = await readTelegramResult<{ id: number }>(meResponse);
    if (!meResponse.ok || !me.ok || !me.result?.id) {
      status.diagnostic = "Telegram rejected the bot token. Check the saved bot token.";
      return status;
    }
    status.botConnected = true;

    if (!chatId) {
      status.diagnostic = "Add a Telegram destination chat ID in project secrets.";
      return status;
    }

    const chat = await postTelegramJson<{ id: number }>(token, "getChat", {
      chat_id: chatId,
    });
    if (!chat.ok || !chat.result?.id) {
      status.diagnostic = "The bot is connected but cannot access the destination chat.";
      return status;
    }
    status.destinationAccessible = true;
  } catch {
    status.diagnostic = "Telegram could not be reached. Check the connection and try again.";
  }

  return status;
}

const requireTelegramReady: RequestHandler = async (_req, res, next) => {
  const status = await checkTelegramReadiness();
  const ready =
    status.configured &&
    status.chatConfigured &&
    status.botConnected &&
    status.destinationAccessible;
  if (!ready) {
    res.status(503).json({
      error: status.diagnostic ?? "The Telegram bot and destination chat are not ready.",
    });
    return;
  }
  next();
};

router.get("/telegram/status", async (_req, res): Promise<void> => {
  const status = await checkTelegramReadiness();
  res.json(GetTelegramStatusResponse.parse(status));
});

router.get("/inbox", async (req, res): Promise<void> => {
  const query = GetInboxQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const search = query.data.search?.trim();
  const escapedSearch = search?.replace(/[\\%_]/g, "\\$&");
  const where = escapedSearch
    ? or(
        ilike(telegramUploadsTable.fileName, `%${escapedSearch}%`),
        ilike(telegramUploadsTable.caption, `%${escapedSearch}%`),
      )
    : undefined;
  const rows = await db
    .select()
    .from(telegramUploadsTable)
    .where(where)
    .orderBy(desc(telegramUploadsTable.sentAt))
    .limit(query.data.limit);

  res.json(GetInboxResponse.parse({ items: rows }));
});

router.get("/inbox/stats", async (_req, res): Promise<void> => {
  const [allTime] = await db.select({ value: count() }).from(telegramUploadsTable);
  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);
  const [today] = await db
    .select({ value: count() })
    .from(telegramUploadsTable)
    .where(gte(telegramUploadsTable.sentAt, startOfToday));

  res.json(
    GetInboxStatsResponse.parse({
      totalSent: allTime?.value ?? 0,
      sentToday: today?.value ?? 0,
    }),
  );
});

router.delete("/inbox/:uploadId", async (req, res): Promise<void> => {
  const params = DeleteInboxUploadParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid inbox item ID." });
    return;
  }

  const [deleted] = await db
    .delete(telegramUploadsTable)
    .where(eq(telegramUploadsTable.id, params.data.uploadId))
    .returning({ id: telegramUploadsTable.id });

  if (!deleted) {
    res.status(404).json({ error: "Inbox item not found." });
    return;
  }

  res.sendStatus(204);
});

router.get("/inbox/:uploadId/media", async (req, res): Promise<void> => {
  const params = GetInboxMediaParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid media ID." });
    return;
  }

  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    res.status(503).json({ error: "Telegram is not configured." });
    return;
  }

  const [item] = await db
    .select({
      mediaType: telegramUploadsTable.mediaType,
      telegramFileId: telegramUploadsTable.telegramFileId,
    })
    .from(telegramUploadsTable)
    .where(eq(telegramUploadsTable.id, params.data.uploadId))
    .limit(1);
  if (!item) {
    res.status(404).json({ error: "Media item not found." });
    return;
  }

  try {
    const fileInfoUrl = new URL(telegramEndpoint(token, "getFile"));
    fileInfoUrl.searchParams.set("file_id", item.telegramFileId);
    const fileInfoResponse = await fetch(fileInfoUrl, {
      signal: AbortSignal.timeout(15_000),
    });
    const fileInfo = await readTelegramResult<{ file_path?: string }>(fileInfoResponse);
    const filePath = fileInfo.result?.file_path;
    if (!fileInfoResponse.ok || !fileInfo.ok || !filePath || filePath.includes("..")) {
      res.status(502).json({ error: "Telegram could not load this media item." });
      return;
    }

    const mediaResponse = await fetch(
      `https://api.telegram.org/file/bot${token}/${filePath}`,
      { signal: AbortSignal.timeout(60_000) },
    );
    if (!mediaResponse.ok) {
      res.status(502).json({ error: "Telegram could not load this media item." });
      return;
    }

    const remoteType = mediaResponse.headers.get("content-type") ?? "";
    const safeType =
      remoteType.startsWith("image/") || remoteType.startsWith("video/")
        ? remoteType
        : item.mediaType === "video"
          ? "video/mp4"
          : "image/jpeg";
    const bytes = Buffer.from(await mediaResponse.arrayBuffer());
    res
      .setHeader("Content-Type", safeType)
      .setHeader("Content-Length", String(bytes.byteLength))
      .setHeader("Cache-Control", "private, max-age=3600")
      .setHeader("X-Content-Type-Options", "nosniff")
      .setHeader("Content-Disposition", "inline")
      .send(bytes);
  } catch {
    res.status(502).json({ error: "Telegram could not load this media item." });
  }
});

router.post(
  "/uploads",
  limitUploadRate,
  requireTelegramReady,
  parseUploadBatch,
  async (req, res): Promise<void> => {
    const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
    const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
    if (!token || !chatId) {
      res.status(503).json({ error: "Add the Telegram bot token and destination chat ID in project secrets." });
      return;
    }

    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    const captionResult = SendUploadsBody.shape.caption.safeParse(req.body?.caption);
    if (!captionResult.success) {
      res.status(400).json({ error: "Captions must be 1,024 characters or shorter." });
      return;
    }
    const caption = captionResult.data?.trim() ?? "";
    if (files.length < 1 || files.length > MAX_FILES) {
      res.status(400).json({ error: `Choose between 1 and ${MAX_FILES} photos or videos.` });
      return;
    }
    if (files.some((file) => !getMediaType(file))) {
      res.status(400).json({ error: "Only image and video files are supported." });
      return;
    }
    if (files.reduce((total, file) => total + file.size, 0) > MAX_BATCH_SIZE) {
      res.status(413).json({ error: "Keep each batch under 80 MB." });
      return;
    }

    const sent: Array<{
      batchIndex: number;
      id: string;
      fileName: string;
      mediaType: "photo" | "video";
      caption: string | null;
      sizeBytes: number;
      telegramMessageId: number;
      telegramFileId: string;
      sentAt: Date;
    }> = [];
    const failed: Array<{
      batchIndex: number;
      fileName: string;
      error: string;
      delivered: boolean | null;
    }> = [];

    for (const [batchIndex, file] of files.entries()) {
      const mediaType = getMediaType(file);
      if (!mediaType) {
        failed.push({
          batchIndex,
          fileName: file.originalname,
          error: "Only image and video files are supported.",
          delivered: false,
        });
        continue;
      }

      const extension = extname(file.originalname).toLowerCase();
      const sendAsVideo = mediaType === "video" && extension === ".mp4";
      const sendAsPhoto =
        mediaType === "photo" &&
        file.size <= MAX_PHOTO_SIZE &&
        [".jpg", ".jpeg", ".png"].includes(extension);
      const method = sendAsVideo ? "sendVideo" : sendAsPhoto ? "sendPhoto" : "sendDocument";
      const field = sendAsVideo ? "video" : sendAsPhoto ? "photo" : "document";
      const body = new FormData();
      body.append("chat_id", chatId);
      if (caption) body.append("caption", caption);
      body.append(
        field,
        new Blob([new Uint8Array(file.buffer)], {
          type: file.mimetype || "application/octet-stream",
        }),
        file.originalname,
      );

      let telegramResult: TelegramResult<{
        message_id?: number;
        photo?: Array<{ file_id?: string }>;
        video?: { file_id?: string };
        document?: { file_id?: string };
      }>;
      try {
        const telegramResponse = await fetch(telegramEndpoint(token, method), {
          method: "POST",
          body,
          signal: AbortSignal.timeout(120_000),
        });
        telegramResult = await readTelegramResult(telegramResponse);
        if (!telegramResponse.ok || !telegramResult.ok) {
          failed.push({
            batchIndex,
            fileName: file.originalname,
            error: telegramResult.description
              ? `Telegram rejected this file: ${telegramResult.description}`
              : "Telegram did not accept this file. Check the bot's access to the chat.",
            delivered: false,
          });
          continue;
        }
      } catch {
        failed.push({
          batchIndex,
          fileName: file.originalname,
          error: "The connection ended before delivery could be confirmed. Check Telegram before retrying.",
          delivered: null,
        });
        continue;
      }

      const message = telegramResult.result;
      const telegramFileId = (
        sendAsPhoto
          ? message?.photo?.at(-1)?.file_id
          : sendAsVideo
            ? message?.video?.file_id
            : message?.document?.file_id
      ) ?? "";
      if (!message?.message_id || !telegramFileId) {
        failed.push({
          batchIndex,
          fileName: file.originalname,
          error: "Telegram accepted the request but did not return a media receipt. Check Telegram before retrying.",
          delivered: null,
        });
        continue;
      }

      try {
        const [row] = await db
          .insert(telegramUploadsTable)
          .values({
            fileName: file.originalname,
            mediaType,
            caption: caption || null,
            sizeBytes: file.size,
            telegramMessageId: message.message_id,
            telegramFileId,
          })
          .returning();
        if (!row) throw new Error("No saved upload row returned.");

        sent.push({
          batchIndex,
          id: row.id,
          fileName: row.fileName,
          mediaType: row.mediaType as "photo" | "video",
          caption: row.caption,
          sizeBytes: row.sizeBytes,
          telegramMessageId: row.telegramMessageId,
          telegramFileId: row.telegramFileId,
          sentAt: row.sentAt,
        });
      } catch (error) {
        req.log.error({ err: error, fileName: file.originalname }, "Telegram media sent but inbox record could not be saved");
        failed.push({
          batchIndex,
          fileName: file.originalname,
          error: "Sent to Telegram, but the website inbox could not save it. Do not resend this file.",
          delivered: true,
        });
      }
    }

    res.json(SendUploadsResponse.parse({ sent, failed }));
  },
);

export default router;
