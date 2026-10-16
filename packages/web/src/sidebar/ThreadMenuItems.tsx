import type { ComponentType, ReactNode } from "react";

interface MenuItemProps {
  onSelect?: () => void;
  variant?: "default" | "destructive";
  children?: ReactNode;
}

interface ThreadMenuItemsProps {
  /** `DropdownMenuItem` or `ContextMenuItem`: the same entries serve both menus. */
  Item: ComponentType<MenuItemProps>;
  archived: boolean;
  onRename(): void;
  onArchive(): void;
  onDelete(): void;
}

export function ThreadMenuItems({ Item, archived, onRename, onArchive, onDelete }: ThreadMenuItemsProps) {
  return (
    <>
      <Item onSelect={onRename}>Rename thread</Item>
      <Item onSelect={onArchive}>{archived ? "Unarchive" : "Archive"}</Item>
      <Item variant="destructive" onSelect={onDelete}>
        Delete
      </Item>
    </>
  );
}
