import React from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Info } from "lucide-react";

interface ParameterControlProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  tooltipText: string;
  suffix?: string;
}

const ParameterControl: React.FC<ParameterControlProps> = ({
  label,
  value,
  onChange,
  min,
  max,
  tooltipText,
  suffix,
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = parseInt(e.target.value, 10);
    if (!isNaN(newValue)) {
      onChange(Math.min(Math.max(newValue, min), max));
    }
  };

  const percentage = ((value - min) / (max - min)) * 100;

  return (
    <div className="bg-white p-2.5 rounded-lg border border-slate-200 shadow-sm">
      <div className="flex items-center justify-between mb-1.5">
        <Label 
          htmlFor={label.toLowerCase()} 
          className="text-xs font-medium text-slate-700 flex items-center gap-1"
        >
          {label}
          <TooltipProvider>
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <Info className="h-3 w-3 text-slate-400 cursor-help transition-colors hover:text-primary" />
              </TooltipTrigger>
              <TooltipContent 
                side="top" 
                className="max-w-xs text-xs bg-slate-800 text-slate-100 border-slate-700"
              >
                <p>{tooltipText}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </Label>
        <div className="text-xs font-medium px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded-full">
          {value}
          {suffix && <span className="ml-0.5">{suffix}</span>}
        </div>
      </div>
      <div className="relative mt-1">
        <div className="mt-0.5 flex mb-1">
          <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
            <div 
              className="h-full bg-primary transition-all duration-200"
              style={{ width: `${percentage}%` }}
            />
          </div>
        </div>
        <div className="flex justify-between text-[9px] text-slate-500 font-medium px-0.5">
          <span>{min}{suffix}</span>
          <span>{max}{suffix}</span>
        </div>
        <Input
          id={label.toLowerCase()}
          type="range"
          min={min}
          max={max}
          value={value}
          onChange={handleChange}
          className="absolute inset-0 opacity-0 cursor-pointer"
          style={{ height: "1.5rem" }}
        />
      </div>
    </div>
  );
};

export default ParameterControl;
