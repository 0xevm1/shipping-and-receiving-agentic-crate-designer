import { DesignerShell } from "@/components/shell/DesignerShell";
import { SavedStateLoader } from "@/components/shell/SavedStateLoader";

export default function Home() {
  return (
    <>
      <SavedStateLoader />
      <DesignerShell />
    </>
  );
}
