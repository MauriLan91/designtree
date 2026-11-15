// The activity bar (US-15.7): always-visible buttons for the side bar's
// views on the left edge, so the library and the outline can be found
// without knowing a shortcut. Each button runs a registry command, so the
// menu, the palette and the shortcut stay the one way to toggle a view.
import type { LucideIcon } from "lucide-react";
import { tooltipOf, type Command } from "../commands";

export interface ActivityItem {
  command: Command;
  icon: LucideIcon;
  /** Whether its view is the one shown; the button then reads as pressed. */
  active: boolean;
}

interface Props {
  views: ActivityItem[];
  /** Pinned to the bottom of the bar, apart from the views. */
  footer: ActivityItem[];
}

function ActivityButton({ command, icon: Icon, active }: ActivityItem) {
  const tip = tooltipOf(command);
  return (
    <button
      className={active ? "activity active" : "activity"}
      onClick={() => command.run()}
      aria-label={command.title.replace(/…$/, "")}
      aria-pressed={active}
      title={tip}
      disabled={command.disabled}
    >
      <Icon size={20} strokeWidth={1.75} aria-hidden />
    </button>
  );
}

export function ActivityBar({ views, footer }: Props) {
  return (
    <>
      {views.map((v) => (
        <ActivityButton key={v.command.id} {...v} />
      ))}
      <span className="spacer" />
      {footer.map((v) => (
        <ActivityButton key={v.command.id} {...v} />
      ))}
    </>
  );
}
