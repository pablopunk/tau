import type { ReactNode } from "react";
import { ImagePreview } from "@/components/ui/image-preview";
import { resultImages } from "../model/tool-state";
import type { ToolRendererProps } from "./types";

export function resultImagesOf(state: ToolRendererProps["state"]): ReactNode {
  const images = resultImages(state.result);
  if (images.length === 0) return null;
  return (
    <ul aria-label="Result images" className="flex flex-wrap gap-2">
      {images.map((image, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: result images have no id and never reorder
        <li key={index}>
          <ImagePreview
            src={`data:${image.mimeType};base64,${image.data}`}
            alt={`Result image ${index + 1}`}
          />
        </li>
      ))}
    </ul>
  );
}
