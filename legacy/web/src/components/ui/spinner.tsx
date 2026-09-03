import { SpinnerGapIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils"

function Spinner({ className, ...props }: React.ComponentProps<typeof SpinnerGapIcon>) {
  return (
    <SpinnerGapIcon data-slot="spinner" role="status" aria-label="Loading" className={cn("size-4 animate-spin", className)} weight="regular" {...props} />
  )
}

export { Spinner }
