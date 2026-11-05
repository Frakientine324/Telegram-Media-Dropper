import { createInsertSchema } from "drizzle-zod";
import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const telegramUploadsTable = pgTable("telegram_uploads", {
  id: uuid("id").defaultRandom().primaryKey(),
  fileName: text("file_name").notNull(),
  mediaType: text("media_type").notNull(),
  caption: text("caption"),
  sizeBytes: integer("size_bytes").notNull(),
  telegramMessageId: integer("telegram_message_id").notNull(),
  telegramFileId: text("telegram_file_id").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTelegramUploadSchema = createInsertSchema(
  telegramUploadsTable,
).omit({ id: true, sentAt: true });

export type InsertTelegramUpload = z.infer<typeof insertTelegramUploadSchema>;
export type TelegramUpload = typeof telegramUploadsTable.$inferSelect;
