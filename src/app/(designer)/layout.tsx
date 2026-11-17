import "../ui.css";
import "./designer.css";

/**
 * The designer's layout (the `(designer)` route group adds no URL segment): the one place the
 * designer-only global CSS loads, so the `/print` route, which sits outside this group, gets the
 * design tokens and base rules from the root layout and nothing else of the designer's.
 */
export default function DesignerLayout({ children }: LayoutProps<"/">) {
  return children;
}
