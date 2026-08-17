import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Folder, Upload, Download, Info } from 'lucide-react';

interface FaceRecognitionInputProps {
  threshold: number;
  setThreshold: (value: number) => void;
  onInputFolderSelect: (files: FileList) => void;
  onComparisonFolderSelect: (files: FileList) => void;
  onSubmit: () => void;
  onExport: () => void;
  inputCount?: number;
  comparisonCount?: number;
  isProcessing: boolean;
  hasResults: boolean;
  thresholdMin?: number;
  thresholdMax?: number;
  thresholdTooltip?: string;
}

const FaceRecognitionInput: React.FC<FaceRecognitionInputProps> = ({
  threshold,
  setThreshold,
  onInputFolderSelect,
  onComparisonFolderSelect,
  onSubmit,
  onExport,
  inputCount,
  comparisonCount,
  isProcessing,
  hasResults,
  thresholdMin,
  thresholdMax,
  thresholdTooltip
}) => {
  // Create refs for the hidden file inputs
  const inputFolderRef = React.useRef<HTMLInputElement>(null);
  const comparisonFolderRef = React.useRef<HTMLInputElement>(null);

  // Handle file input changes
  const handleInputFolderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onInputFolderSelect(e.target.files);
    }
  };

  const handleComparisonFolderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onComparisonFolderSelect(e.target.files);
    }
  };

  return (
    <Card className="bg-white border shadow-sm">
      <CardContent className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
          {/* Input Folder Selection */}
          <div className="md:col-span-4 flex flex-col gap-2">
            <Label htmlFor="input-folder" className="font-medium">Input Folder</Label>
            <div className="flex flex-col gap-2">
              <Button 
                variant="outline" 
                className="w-full flex items-center gap-2 h-12"
                onClick={() => inputFolderRef.current?.click()}
                disabled={isProcessing}
              >
                <Folder className="h-5 w-5 text-primary" />
                <span>Select Input Folder</span>
              </Button>
              <input 
                ref={inputFolderRef}
                type="file" 
                id="input-folder"
                multiple
                accept="image/*,application/pdf"
                className="hidden"
                onChange={handleInputFolderChange}
                disabled={isProcessing}
              />
              {inputCount !== undefined && (
                <p className="text-sm text-muted-foreground text-center">
                  {inputCount} file{inputCount === 1 ? '' : 's'} selected
                </p>
              )}
            </div>
          </div>

          {/* Comparison Folder Selection */}
          <div className="md:col-span-4 flex flex-col gap-2">
            <Label htmlFor="comparison-folder" className="font-medium">Comparison Folder</Label>
            <div className="flex flex-col gap-2">
              <Button 
                variant="outline" 
                className="w-full flex items-center gap-2 h-12"
                onClick={() => comparisonFolderRef.current?.click()}
                disabled={isProcessing}
              >
                <Folder className="h-5 w-5 text-primary" />
                <span>Select Comparison Folder</span>
              </Button>
              <input 
                ref={comparisonFolderRef}
                type="file" 
                id="comparison-folder"
                multiple
                accept="image/*,application/pdf"
                className="hidden"
                onChange={handleComparisonFolderChange}
                disabled={isProcessing}
              />
              {comparisonCount !== undefined && (
                <p className="text-sm text-muted-foreground text-center">
                  {comparisonCount} file{comparisonCount === 1 ? '' : 's'} selected
                </p>
              )}
            </div>
          </div>

          {/* Threshold Slider */}
          <div className="md:col-span-2 flex flex-col gap-2">
            <div className="flex items-center gap-1">
              <Label htmlFor="threshold" className="font-medium">Threshold</Label>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help ml-1" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{thresholdTooltip || 'Threshold value between 30 and 100 for face matching confidence.'}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <div className="flex items-center gap-2">
              <Slider
                id="threshold"
                min={thresholdMin || 30}
                max={thresholdMax || 100}
                value={[threshold]}
                onValueChange={(value) => setThreshold(value[0])}
                className="h-12"
                disabled={isProcessing}
              />
              <span className="text-sm text-muted-foreground w-12 text-center">{threshold}</span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="md:col-span-2 flex flex-col gap-3">
            <Button 
              onClick={onSubmit}
              className="h-10 w-full flex items-center gap-2"
              disabled={isProcessing || !inputCount || !comparisonCount}
            >
              <Upload className="h-4 w-4" />
              <span>Submit</span>
            </Button>
            <Button 
              variant="outline" 
              onClick={onExport}
              className="h-10 w-full flex items-center gap-2"
              disabled={isProcessing || !hasResults}
            >
              <Download className="h-4 w-4" />
              <span>Export</span>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default FaceRecognitionInput;