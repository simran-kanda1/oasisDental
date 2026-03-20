import * as React from "react"
import { cn } from "../../lib/utils"

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
    children: React.ReactNode
}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
    ({ className, children, ...props }, ref) => {
        return (
            <select
                ref={ref}
                className={cn(
                    "flex h-9 w-full items-center justify-between rounded-lg border border-input bg-background px-3 py-1 text-sm shadow-sm ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
                    className
                )}
                {...props}
            >
                {children}
            </select>
        )
    }
)
Select.displayName = "Select"

export { Select }
