import { TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { NativeNotice as NativeNoticeData } from "../model/native-thread";

export function NativeNotice({ notice }: { notice: NativeNoticeData }) {
  return (
    <Alert>
      <TriangleAlert aria-hidden />
      <AlertTitle>{notice.text}</AlertTitle>
      {notice.reason ? <AlertDescription>{notice.reason}</AlertDescription> : null}
    </Alert>
  );
}
