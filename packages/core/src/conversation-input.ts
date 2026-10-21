import type { ImageContent, TextContent, UserMessage } from "@earendil-works/pi-ai";
import { AppError, type FileRef, type ImageInput, type SendMessageInput } from "@tau/protocol";

type MessageContent = UserMessage["content"];
type MessageParts = Exclude<MessageContent, string>;

const SIGNATURE_BASE64_CHARS = 24;

const startsWith = (bytes: Buffer, signature: readonly number[], offset = 0) =>
  signature.every((byte, position) => bytes[offset + position] === byte);

const SIGNATURE_CHECKS: Record<ImageInput["mimeType"], (bytes: Buffer) => boolean> = {
  "image/png": (bytes) => startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  "image/jpeg": (bytes) => startsWith(bytes, [0xff, 0xd8, 0xff]),
  "image/gif": (bytes) => startsWith(bytes, [0x47, 0x49, 0x46, 0x38]),
  "image/webp": (bytes) =>
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8),
};

const imagesOf = (input: Pick<SendMessageInput, "images">): ImageInput[] => input.images ?? [];

const filesOf = (input: Pick<SendMessageInput, "files">): FileRef[] => input.files ?? [];

export function requireContent(input: Pick<SendMessageInput, "text" | "images" | "files">): void {
  if (input.text.trim() === "" && imagesOf(input).length === 0 && filesOf(input).length === 0) {
    throw new AppError("invalid_request", "Write a message or attach a file.");
  }
}

export function requireImageBytesMatchTheirType(input: Pick<SendMessageInput, "images">): void {
  for (const image of imagesOf(input)) {
    const head = Buffer.from(image.data.slice(0, SIGNATURE_BASE64_CHARS), "base64");
    if (!SIGNATURE_CHECKS[image.mimeType]?.(head)) {
      throw new AppError("invalid_request", `An attached image is not a valid ${image.mimeType} file.`);
    }
  }
}

export function requireImagesAllowed(
  input: Pick<SendMessageInput, "images">,
  model: { readonly input: readonly string[] } | undefined,
): void {
  if (imagesOf(input).length === 0) return;
  if (!model?.input.includes("image")) {
    throw new AppError("images_not_supported", "This model cannot read images. Choose another model.");
  }
}

export function toUserInput(
  input: Pick<SendMessageInput, "text" | "images" | "files">,
  /** Maps a staged virtual path to the disk path the agent reads it from. */
  readFrom: (file: FileRef) => string | undefined = () => undefined,
): MessageContent {
  const images = imagesOf(input);
  const files = filesOf(input);
  if (images.length === 0 && files.length === 0) return input.text;
  const text: TextContent[] = input.text.trim() === "" ? [] : [{ type: "text", text: input.text }];
  const pictures: ImageContent[] = images.map((image) => ({ type: "image", ...image }));
  // Path-only context: the agent sees where the staged file lives, never its bytes.
  const attachments: TextContent[] = files.map((file) => {
    const readable = readFrom(file);
    const quoted = `Attached file: "${file.path}"`;
    return {
      type: "text",
      text: readable === undefined ? quoted : `${quoted}\nRead it from: ${readable}`,
    };
  });
  const parts: MessageParts = [...text, ...pictures, ...attachments];
  return parts;
}

/** Looks resolved uploads up by virtual path for `toUserInput`. */
export function readFromResolved(
  resolved: readonly { readonly ref: FileRef; readonly absPath: string }[],
): (file: FileRef) => string | undefined {
  const byPath = new Map(resolved.map((entry) => [entry.ref.path, entry.absPath]));
  return (file) => byPath.get(file.path);
}
