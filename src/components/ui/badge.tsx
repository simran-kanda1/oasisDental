import * as React from "react"
import { cn } from "../../lib/utils"

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
    variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning'
}

function Badge({ className, variant = 'default', ...props }: BadgeProps) {
    const variantClasses = {
        default: "bg-primary text-primary-foreground",
        secondary: "bg-secondary text-secondary-foreground",
        destructive: "bg-destructive/15 text-destructive border-destructive/30",
        outline: "border border-border bg-transparent text-foreground",
        success: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30",
        warning: "bg-amber-500/15 text-amber-400 border border-amber-500/30",
    }
    return (
        <div
            className={cn(
                "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors",
                variantClasses[variant],
                className
            )}
            {...props}
        />
    )
}

export { Badge }
