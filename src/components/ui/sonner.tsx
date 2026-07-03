import { CheckCircleIcon, InfoIcon, SpinnerGapIcon, WarningCircleIcon, XCircleIcon } from "@phosphor-icons/react";
"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: (
          <CheckCircleIcon className="size-4" weight="regular" />
        ),
        info: (
          <InfoIcon className="size-4" weight="regular" />
        ),
        warning: (
          <WarningCircleIcon className="size-4" weight="regular" />
        ),
        error: (
          <XCircleIcon className="size-4" weight="regular" />
        ),
        loading: (
          <SpinnerGapIcon className="size-4 animate-spin" weight="regular" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
