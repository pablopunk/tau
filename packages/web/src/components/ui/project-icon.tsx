import { HomeIcon } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"

const HUES = 360

export function hueOfId(id: string): number {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) % HUES
  return hash
}

interface ProjectIconProps extends Omit<React.ComponentProps<typeof Avatar>, "children"> {
  id: string
  name: string
  /** The project's `iconUrl`; the letter shows while it loads, when it is missing and when it fails. */
  iconUrl?: string | null
  /** Home has a fixed house icon instead of a letter. */
  home?: boolean
  /** Side of the tile in px. Default 17. */
  tile?: number
}

function ProjectIcon({ id, name, iconUrl, home = false, tile = 17, className, ...props }: ProjectIconProps) {
  const hue = hueOfId(id)
  return (
    <Avatar
      data-slot="project-icon"
      className={cn("rounded-sm after:rounded-sm", className)}
      style={{ width: tile, height: tile }}
      {...props}
    >
      {iconUrl && !home ? (
        <AvatarImage src={iconUrl} alt="" className="rounded-sm animate-in fade-in" />
      ) : null}
      <AvatarFallback
        className="rounded-sm text-[0.6rem] font-medium"
        style={{
          backgroundColor: `color-mix(in oklab, oklch(0.7 0.14 ${hue}) 25%, transparent)`,
          color: `oklch(0.55 0.14 ${hue})`,
        }}
      >
        {home ? <HomeIcon className="size-3" /> : (name.trim().charAt(0).toUpperCase() || "?")}
      </AvatarFallback>
    </Avatar>
  )
}

export { ProjectIcon }
export type { ProjectIconProps }
