import type { HeroView } from "@/modules/hero";
import { Segmented } from "./ui/segmented";

/**
 * The hero view toggle — a small segmented control, Rendered | Source,
 * defaulting Rendered (DESIGN §5, ARCHITECTURE §7). Sentence-case labels.
 */
export function ViewToggle({
  value,
  onChange,
}: {
  value: HeroView;
  onChange: (view: HeroView) => void;
}) {
  return (
    <Segmented
      options={[
        { value: "rendered", label: "Rendered" },
        { value: "source", label: "Source" },
      ]}
      value={value}
      onChange={onChange}
    />
  );
}
