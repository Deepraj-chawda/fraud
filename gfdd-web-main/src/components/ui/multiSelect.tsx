import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
} from "@radix-ui/react-dropdown-menu"
import { Slot } from "@radix-ui/react-slot"
import { useState, useEffect } from "react"
import { cn } from "@/lib/utils"
interface MultiSelectProps {
  placeholder: string
  className: string
}
const MultiSelectDropdown = ({
  options,
  defaultValue,
  value,
  placeholder,
  className,
  onChange,
}: {
  options: Array<{ value: string; label: string }>
  defaultValue?: string[]
  value?: string[]
  placeholder: string
  className: string
  onChange?: (value: string[]) => void
}) => {
  const [selectedItems, setSelectedItems] = useState<string[]>(
    defaultValue || []
  )
  const [isOpen, setIsOpen] = useState(false)
  useEffect(() => {
    if (value !== undefined) {
      setSelectedItems(value)
    }
  }, [value])
  const toggleItem = (value: string) => {
    setSelectedItems((prev) => {
      const isSelected = prev.includes(value)
      const newItems = isSelected
        ? prev.filter((item) => item !== value)
        : [...prev, value]
      if (onChange) {
        onChange(newItems)
      }
      return newItems
    })
  }
  const getDisplayValue = () => {
    if (selectedItems.length === 0) {
      return placeholder
    }
    const labels = selectedItems.map((value) => {
      const option = options.find((o) => o.value === value)
      return option ? option.label : value
    })
    return labels.join(", ")
  }
  const CustomItem = ({ value, label }: { value: string; label: string }) => {
    const isSelected = selectedItems.includes(value)
    return (
      <div className="flex items-center gap-2 p-2 hover:bg-blue-100 rounded cursor-pointer">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => toggleItem(value)}
          className="h-4 w-4 text-blue-600 rounded"
        />
        <span className="text-gray-700 text-sm">{label}</span>
      </div>
    )
  }
  return (
    <div className={cn("relative", className)}>
      <DropdownMenu
        state={{ open: isOpen }}
        onStateChange={(state) => setIsOpen(state.open)}
      >
        <DropdownMenuTrigger
          className={cn(
            "rounded-md focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
            className
          )}
        >
          <p
            className={cn(
              "relative text-left text-slate-600 font-normal px-4 w-full py-2 bg-white border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            )}
          >
            {getDisplayValue()}
            <span className="ml-2 text-gray-400 absolute right-1">▼</span>
          </p>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className={cn(
            "min-w-[--radix-dropdown-menu-trigger-width] w1-[calc(100%+2px)] origin-top-left left-0 p-2 top-full mt-1 bg-white border outline-none rounded-md shadow-lg focus:outline-none focus:ring-0 focus:ring-ring focus:ring-offset-2 z-50",
            className,
            "overflow-x-hidden" // 防止内容溢出
          )}
        >
          <DropdownMenuGroup>
            {options.map((option) => (
              <DropdownMenuItem
                className="outline-none focus:ring-ring focus:bg-accent"
                key={option.value}
              >
                <CustomItem value={option.value} label={option.label} />
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
export default MultiSelectDropdown
