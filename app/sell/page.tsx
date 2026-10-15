import { SellForm } from "./SellForm";
import { isMuseEnabled } from "@/lib/ai/muse";

export default function SellPage() {
  return (
    <>
      <h1>拍照即上架</h1>
      <p className="lead">放一張照片、說一句話，AI 會填好品名、分類、成色與建議售價。你只需要確認。</p>
      <SellForm museEnabled={isMuseEnabled()} />
    </>
  );
}
