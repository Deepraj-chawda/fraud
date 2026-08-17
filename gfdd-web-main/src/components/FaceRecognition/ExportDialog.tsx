
import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FileJson, FileText, Loader } from 'lucide-react';

interface ExportDialogProps {
  showDialog: boolean;
  setShowDialog: (show: boolean) => void;
  onExportConfirm: (format: 'csv' | 'json') => void;
  isProcessing: boolean;
}

const ExportDialog: React.FC<ExportDialogProps> = ({
  showDialog,
  setShowDialog,
  onExportConfirm,
  isProcessing
}) => {
  return (
    <Dialog open={showDialog} onOpenChange={(open) => {
      // Don't allow closing dialog by outside click while processing
      if (isProcessing && !open) return;
      setShowDialog(open);
    }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export Results</DialogTitle>
          <DialogDescription>
            Choose a format to export your face recognition results.
          </DialogDescription>
        </DialogHeader>
        
        {isProcessing ? (
          <div className="py-8 flex flex-col items-center justify-center">
            <Loader className="h-8 w-8 text-primary animate-spin mb-4" />
            <p className="text-center text-muted-foreground">
              Preparing your export file...
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 py-4">
            <Button
              variant="outline"
              className="h-32 flex flex-col items-center justify-center gap-2"
              onClick={() => onExportConfirm('csv')}
              disabled={isProcessing}
            >
              <FileText className="h-10 w-10 mb-2" />
              <span className="font-medium">CSV Format</span>
              <span className="text-xs text-muted-foreground">
                Spreadsheet-friendly
              </span>
            </Button>
            <Button
              variant="outline"
              className="h-32 flex flex-col items-center justify-center gap-2"
              onClick={() => onExportConfirm('json')}
              disabled={isProcessing}
            >
              <FileJson className="h-10 w-10 mb-2" />
              <span className="font-medium">JSON Format</span>
              <span className="text-xs text-muted-foreground">
                Developer-friendly
              </span>
            </Button>
          </div>
        )}

        <DialogFooter className="flex justify-between sm:justify-between">
          <Button
            variant="outline"
            onClick={() => setShowDialog(false)}
            disabled={isProcessing}
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ExportDialog;
