import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Progress } from "@/components/ui/progress";
import { Upload, X, Image as ImageIcon, Folder, Files } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

interface UploadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploadComplete: (files: File[]) => void;
  uploadMode?: 'single' | 'multiple';
  forceMultiple?: boolean;
}

const UploadModal: React.FC<UploadModalProps> = ({ 
  open, 
  onOpenChange, 
  onUploadComplete,
  uploadMode = 'single',
  forceMultiple = false
}) => {
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [localUploadMode, setLocalUploadMode] = useState<'single' | 'multiple'>(forceMultiple ? 'multiple' : uploadMode);
  const { toast } = useToast();

  // Reset state when modal opens or uploadMode changes
  useEffect(() => {
    if (open) {
      setLocalUploadMode(forceMultiple ? 'multiple' : uploadMode);
      setFiles([]);
      setUploading(false);
      setProgress(0);
    }
  }, [open, uploadMode, forceMultiple]);

  const handleFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      if (localUploadMode === 'single') {
        // For single mode, only take the first file
        setFiles([e.target.files[0]]);
      } else {
        // For multiple mode, take all files
        const selectedFiles = Array.from(e.target.files);
        setFiles(selectedFiles);
      }
      
      toast({
        title: `${localUploadMode === 'single' ? '1 file' : `${e.target.files.length} files`} selected`,
        description: "Ready to upload",
      });
    }
  };

  const removeFile = (index: number) => {
    setFiles((prevFiles) => prevFiles.filter((_, i) => i !== index));
  };

  const handleUpload = () => {
    if (files.length === 0) return;
    
    setUploading(true);
    
    // Simulate upload progress
    let progressValue = 0;
    const interval = setInterval(() => {
      progressValue += 10;
      setProgress(progressValue);
      
      if (progressValue >= 100) {
        clearInterval(interval);
        setTimeout(() => {
          setUploading(false);
          onUploadComplete(files);
          toast({
            title: "Upload complete",
            description: `${files.length} ${files.length === 1 ? 'file' : 'files'} uploaded successfully`,
          });
          onOpenChange(false);
          setFiles([]);
          setProgress(0);
        }, 50);
      }
    }, 100);
  };

  // Function to truncate filename with ellipsis if too long
  const truncateFilename = (filename: string, maxLength: number = 24) => {
    if (filename.length <= maxLength) return filename;
    
    // Get file extension
    const lastDot = filename.lastIndexOf('.');
    const extension = lastDot !== -1 ? filename.substring(lastDot) : '';
    
    // Keep start of the filename and add ellipsis
    const nameWithoutExtension = lastDot !== -1 ? filename.substring(0, lastDot) : filename;
    const truncatedName = nameWithoutExtension.substring(0, maxLength - 3 - extension.length) + '...';
    
    return truncatedName + extension;
  };

  // Function to get file type badge
  const getFileTypeBadge = (filename: string) => {
    const extension = filename.split('.').pop()?.toLowerCase();
    if (extension === 'pdf') {
      return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">PDF</Badge>;
    }
    return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">Image</Badge>;
  };

  return (
    <Dialog 
      open={open} 
      onOpenChange={(newOpenState) => {
        // Only allow the dialog to close if we're not uploading
        if (uploading && !newOpenState) {
          return;
        }
        onOpenChange(newOpenState);
      }}
    >
      <DialogContent 
        className="sm:max-w-md"
        preventOutsideClickClose={uploading}
        onPointerDownOutside={(e) => {
          // Prevent the modal from closing when uploading
          if (uploading) {
            e.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Upload Files</DialogTitle>
          <DialogDescription>
            Upload images and PDFs for analysis
          </DialogDescription>
        </DialogHeader>
        
        {!uploading ? (
          <>
            {!forceMultiple && (
              <Tabs value={localUploadMode} onValueChange={(value) => setLocalUploadMode(value as 'single' | 'multiple')}>
                <TabsList className="grid w-full grid-cols-2 mb-4">
                  <TabsTrigger value="single" className="flex items-center gap-2">
                    <ImageIcon className="h-4 w-4" />
                    Single File
                  </TabsTrigger>
                  <TabsTrigger value="multiple" className="flex items-center gap-2">
                    <Folder className="h-4 w-4" />
                    Folder
                  </TabsTrigger>
                </TabsList>
                
                <TabsContent value="single" className="space-y-4">
                  <div 
                    className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center hover:border-primary/60 transition-colors cursor-pointer"
                    onClick={() => document.getElementById('file-upload-single')?.click()}
                  >
                    <Upload className="h-10 w-10 mx-auto text-slate-400" />
                    <p className="mt-2 text-slate-600">
                      Click to select a file
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      Supported formats: JPEG, PNG, GIF, TIFF, BMP, PDF
                    </p>
                    <input
                      id="file-upload-single"
                      type="file"
                      accept="image/*,application/pdf"
                      className="hidden"
                      onChange={handleFilesSelected}
                    />
                  </div>
                  {files.length > 0 && (
                    <div className="rounded-md border overflow-hidden">
                      <div className="flex justify-between items-center p-2 bg-slate-50">
                        <div className="flex items-center gap-2">
                          <div className="text-sm font-medium truncate max-w-[85%]" title={files[0].name}>
                            {truncateFilename(files[0].name)}
                          </div>
                          {getFileTypeBadge(files[0].name)}
                        </div>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => setFiles([])}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </TabsContent>
                
                <TabsContent value="multiple" className="space-y-4">
                  <div 
                    className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center hover:border-primary/60 transition-colors cursor-pointer"
                    onClick={() => document.getElementById('file-upload-multiple')?.click()}
                  >
                    <Folder className="h-10 w-10 mx-auto text-slate-400" />
                    <p className="mt-2 text-slate-600">
                      Click to select a folder
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      Select an entire folder with images or PDFs
                    </p>
                    <input
                      id="file-upload-multiple"
                      type="file"
                      multiple
                      accept="image/*,application/pdf"
                      className="hidden"
                      // webkitdirectory={true}
                      // mozdirectory="true"
                      // directory={true}
                      onChange={handleFilesSelected}
                    />
                  </div>
                  
                  {files.length > 0 && (
                    <div className="max-h-40 overflow-y-auto space-y-2 p-2 border rounded-md">
                      {files.map((file, index) => (
                        <div key={index} className="flex justify-between items-center p-2 bg-slate-50 rounded">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <div className="text-sm font-medium truncate max-w-[85%]" title={file.name}>
                              {truncateFilename(file.name)}
                            </div>
                            {getFileTypeBadge(file.name)}
                          </div>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => removeFile(index)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            )}
            
            {forceMultiple && (
              <div className="space-y-4">
                <div 
                  className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center hover:border-primary/60 transition-colors cursor-pointer"
                  onClick={() => document.getElementById('file-upload-multiple-forced')?.click()}
                >
                  <Folder className="h-10 w-10 mx-auto text-slate-400" />
                  <p className="mt-2 text-slate-600">
                    Click to select a folder
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    Select folder for batch processing
                  </p>
                  <input
                    id="file-upload-multiple-forced"
                    type="file"
                    multiple
                    accept="image/*,application/pdf"
                    className="hidden"
                    // webkitdirectory={true}
                    // mozdirectory="true"
                    // directory={true}
                    onChange={handleFilesSelected}
                  />
                </div>
                
                {files.length > 0 && (
                  <div className="max-h-40 overflow-y-auto space-y-2 p-2 border rounded-md">
                    {files.map((file, index) => (
                      <div key={index} className="flex justify-between items-center p-2 bg-slate-50 rounded">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <div className="text-sm font-medium truncate max-w-[85%]" title={file.name}>
                            {truncateFilename(file.name)}
                          </div>
                          {getFileTypeBadge(file.name)}
                        </div>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => removeFile(index)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            
            <DialogFooter className="sm:justify-between">
              <div className="text-sm text-slate-500">
                {files.length} {files.length === 1 ? 'file' : 'files'} selected
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button onClick={handleUpload} disabled={files.length === 0}>
                  Upload
                </Button>
              </div>
            </DialogFooter>
          </>
        ) : (
          <div className="space-y-4 py-4">
            <Progress value={progress} />
            <p className="text-center text-sm text-slate-500">
              {progress === 100 ? 'Processing...' : `Uploading... ${progress}%`}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default UploadModal;