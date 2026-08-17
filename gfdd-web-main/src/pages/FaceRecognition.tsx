import React, { useState, useCallback, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import {
  Folder, 
  Upload, 
  Download,
  Info,
  AlertCircle,
  Loader,
  CheckCircle, 
  ArrowRight, 
  ImageIcon,
  Users
} from 'lucide-react';
import FaceRecognitionInput from '@/components/FaceRecognition/FaceRecognitionInput';
import FaceRecognitionResults from '@/components/FaceRecognition/FaceRecognitionResults';
import ExportDialog from '@/components/FaceRecognition/ExportDialog';
import EmptyState from '@/components/FaceRecognition/EmptyState';
import { compareImages } from '@/api/services/compareFaces';
import { isAuthenticated } from '@/api/auth';
import { useNavigate } from 'react-router-dom';

// Types for the face recognition feature
export interface ImageFile {
  id: string;
  name: string;
  url: string;
  file: File; 
  matches?: Match[];
  isSelected?: boolean;
}

export interface Match {
  id: string;
  name: string;
  url: string;
  score: number;
  distance: number;
}

export interface ProcessingStatus {
  isProcessing: boolean;
  current: number;
  total: number;
  progressPercent: number;
}

const FaceRecognition: React.FC = () => {
  const [inputFolder, setInputFolder] = useState<ImageFile[] | null>(null);
  const [comparisonFolder, setComparisonFolder] = useState<ImageFile[] | null>(null);
  const [threshold, setThreshold] = useState<number>(30); 
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatus>({
    isProcessing: false,
    current: 0,
    total: 0,
    progressPercent: 0
  });
  const [results, setResults] = useState<ImageFile[] | null>(null);
  const [selectedImage, setSelectedImage] = useState<ImageFile | null>(null);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportProcessing, setExportProcessing] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  // useEffect(() => {
  //   if (!isAuthenticated()) {
  //     toast({
  //       title: "Authentication required",
  //       description: "Please log in to access this page",
  //       variant: "destructive",
  //     });
  //     navigate("/login");
  //   }
  // }, [navigate, toast]);

  const handleInputFolderSelect = useCallback((files: FileList) => {
    const validFiles: ImageFile[] = Array.from(files)
      .filter(file => file.type.startsWith('image/') || file.type === 'application/pdf')
      .map(file => ({
        id: `input-${Math.random().toString(36).substring(2, 11)}`,
        name: file.name,
        url: URL.createObjectURL(file),
        file
      }));
    
    if (validFiles.length === 0) {
      toast({
        title: "No valid files",
        description: "Please select images (JPEG, PNG, etc.) or PDFs for the input folder.",
        variant: "destructive"
      });
      return;
    }

    setInputFolder(validFiles);
    toast({
      title: "Input folder selected",
      description: `${validFiles.length} file${validFiles.length === 1 ? '' : 's'} uploaded successfully.`
    });
  }, [toast]);

  const handleComparisonFolderSelect = useCallback((files: FileList) => {
    const validFiles: ImageFile[] = Array.from(files)
      .filter(file => file.type.startsWith('image/') || file.type === 'application/pdf')
      .map(file => ({
        id: `comparison-${Math.random().toString(36).substring(2, 11)}`,
        name: file.name,
        url: URL.createObjectURL(file),
        file
      }));
    
    if (validFiles.length === 0) {
      toast({
        title: "No valid files",
        description: "Please select images (JPEG, PNG, etc.) or PDFs for the comparison folder.",
        variant: "destructive"
      });
      return;
    }

    setComparisonFolder(validFiles);
    toast({
      title: "Comparison folder selected",
      description: `${validFiles.length} file${validFiles.length === 1 ? '' : 's'} uploaded successfully.`
    });
  }, [toast]);

  const handleThresholdChange = useCallback((value: number) => {
    if (value < 30 || value > 100 || isNaN(value)) {
      setThreshold(30);
    } else {
      setThreshold(value);
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!inputFolder || !comparisonFolder) {
      toast({
        title: "Missing folders",
        description: "Please select both input and comparison folders.",
        variant: "destructive"
      });
      return;
    }

    // Start processing
    setProcessingStatus({
      isProcessing: true,
      current: 0,
      total: inputFolder.length,
      progressPercent: 0
    });
    setResults([]);
    setSelectedImage(null);

    let totalMatches = 0;
    const errorMessages: string[] = [];

    try {
      // Process each input image one at a time
      for (let i = 0; i < inputFolder.length; i++) {
        const inputImg = inputFolder[i];
        const inputFile = [inputImg.file];
        const compareFiles = comparisonFolder.map(img => img.file);

        try {
          // Call API for one input image
          const response = await compareImages(inputFile, compareFiles, threshold);

          // Process matches for this input image
          const matches = response.matches
            .filter(match => match.input_file === inputImg.name && match.matched)
            .map(match => {
              const compareImg = comparisonFolder.find(img => img.name === match.compare_file);
              return {
                id: compareImg?.id || `match-${Math.random().toString(36).substring(2, 11)}`,
                name: match.compare_file,
                url: compareImg?.url || '',
                score: match.result,
                distance: match.distance
              };
            });

          // Append to results
          const newResult = {
            ...inputImg,
            matches
          };

          setResults(prev => {
            const updatedResults = [...(prev || []), newResult];
            // Set selectedImage to this result if it has matches
            if (matches.length > 0) {
              setSelectedImage(newResult);
            }
            return updatedResults;
          });

          totalMatches += matches.length;
          if (response.errors.length > 0) {
            errorMessages.push(...response.errors);
          }

          // Update progress
          setProcessingStatus({
            isProcessing: true,
            current: i + 1,
            total: inputFolder.length,
            progressPercent: ((i + 1) / inputFolder.length) * 100
          });

          // Show toast for this image's completion
          toast({
            title: `Processed ${inputImg.name}`,
            description: `${matches.length} match${matches.length === 1 ? '' : 'es'} found.`,
            duration: 3000
          });
        } catch (error) {
          console.error(`Error processing ${inputImg.name}:`, error);
          errorMessages.push(inputImg.name);
          // Still append the image with no matches to maintain result order
          setResults(prev => [...(prev || []), { ...inputImg, matches: [] }]);
          setProcessingStatus({
            isProcessing: true,
            current: i + 1,
            total: inputFolder.length,
            progressPercent: ((i + 1) / inputFolder.length) * 100
          });
        }
      }

      // Complete processing
      setProcessingStatus({
        isProcessing: false,
        current: inputFolder.length,
        total: inputFolder.length,
        progressPercent: 100
      });

      // Reset form
      setInputFolder(null);
      setComparisonFolder(null);
      setThreshold(30);

      // Show completion toast
      toast({
        title: "Processing complete",
        description: `Found ${totalMatches} matches for ${results?.length || 0} out of ${inputFolder.length} file${inputFolder.length === 1 ? '' : 's'}.`
      });

      if (errorMessages.length > 0) {
        toast({
          title: "Processing errors",
          description: `${errorMessages.length} file${errorMessages.length === 1 ? '' : 's'} could not be processed: ${errorMessages.join(', ')}`,
          variant: "destructive"
        });
      }
    } catch (error) {
      console.error('Error during processing:', error);
      toast({
        title: "Error",
        description: `Failed to process files: ${error instanceof Error ? error.message : 'Unknown error'}`,
        variant: "destructive"
      });
      setProcessingStatus({
        isProcessing: false,
        current: 0,
        total: inputFolder.length,
        progressPercent: 0
      });
      setResults(null);
      setSelectedImage(null);
    }
  }, [inputFolder, comparisonFolder, threshold, toast, selectedImage, results]);

  const handleExport = useCallback(() => {
    setShowExportDialog(true);
  }, []);

  const handleExportConfirm = useCallback((format: 'csv' | 'json') => {
    if (!results || results.length === 0) {
      toast({
        title: "No results to export",
        description: "Process files first to get exportable results.",
        variant: "destructive"
      });
      return;
    }

    setExportProcessing(true);

    setTimeout(() => {
      let exportData;
      let fileName;
      let dataUrl;

      if (format === 'json') {
        exportData = JSON.stringify(results, null, 2);
        fileName = 'face-recognition-results.json';
        const blob = new Blob([exportData], { type: 'application/json' });
        dataUrl = URL.createObjectURL(blob);
      } else {
        const csvRows = [
          ['Input File', 'Compare File', 'Matched', 'Distance', 'Threshold', 'Result'].join(','),
          ...results.flatMap(input =>
            input.matches ? input.matches.map(match => [
              `"${input.name.replace(/"/g, '""')}"`,
              `"${match.name.replace(/"/g, '""')}"`,
              'true',
              match.distance.toFixed(2),
              threshold.toFixed(2),
              match.score.toFixed(2)
            ].join(',')) : []
          )
        ];
        exportData = csvRows.join('\n');
        fileName = 'face-recognition-results.csv';
        const blob = new Blob([exportData], { type: 'text/csv' });
        dataUrl = URL.createObjectURL(blob);
      }

      const downloadLink = document.createElement('a');
      downloadLink.href = dataUrl;
      downloadLink.download = fileName;
      downloadLink.click();

      setExportProcessing(false);
      setShowExportDialog(false);

      toast({
        title: "Export successful",
        description: `Results exported as ${format.toUpperCase()}.`
      });
    }, 1500);
  }, [results, threshold, toast]);

  const handleImageSelect = useCallback((image: ImageFile) => {
    setSelectedImage(image);
  }, []);

  const showEmptyState = !inputFolder && !comparisonFolder && (!results || results.length === 0);

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      {/* Page Header */}
      <div className="border-b bg-white p-4 flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">Face Recognition</h1>
        </div>
      </div>

      <div className="flex-1 p-4 md:p-6 max-w-full mx-auto w-full">
        {/* Input Section */}
        <FaceRecognitionInput 
          threshold={threshold}
          setThreshold={handleThresholdChange}
          onInputFolderSelect={handleInputFolderSelect}
          onComparisonFolderSelect={handleComparisonFolderSelect}
          onSubmit={handleSubmit}
          onExport={handleExport}
          inputCount={inputFolder?.length}
          comparisonCount={comparisonFolder?.length}
          isProcessing={processingStatus.isProcessing}
          hasResults={!!results && results.length > 0}
          thresholdMin={30}
          thresholdMax={100}
          thresholdTooltip="Threshold value between 30 and 100 for face matching confidence."
        />
        
        {/* Processing Indicator */}
        {processingStatus.isProcessing && (
          <Card className="my-4 animate-fade-in">
            <CardContent className="p-4">
              <div className="flex flex-col gap-2">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <Loader className="h-4 w-4 animate-spin text-primary" />
                    <span className="font-medium">Processing...</span>
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {processingStatus.current} of {processingStatus.total} file{processingStatus.total === 1 ? '' : 's'}
                  </span>
                </div>
                <Progress value={processingStatus.progressPercent} className="h-2" />
                <p className="text-sm text-muted-foreground">
                  Processing file {processingStatus.current} of {processingStatus.total} from Input Folder...
                </p>
              </div>
            </CardContent>
          </Card>
        )}
        
        {/* Results Section */}
        <div className="mt-6">
          {results && results.length > 0 ? (
            <FaceRecognitionResults 
              results={results}
              selectedImage={selectedImage}
              onImageSelect={handleImageSelect}
              threshold={threshold}
            />
          ) : inputFolder && comparisonFolder && !processingStatus.isProcessing ? (
            <Card className="bg-white p-6 text-center">
              <div className="flex flex-col items-center gap-2">
                <ArrowRight className="h-10 w-10 text-muted-foreground mb-2" />
                <h3 className="text-lg font-medium">Ready to Process</h3>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  Both input and comparison folders are ready. Click the "Submit" button above to start the face recognition process.
                </p>
              </div>
            </Card>
          ) : showEmptyState ? (
            <EmptyState />
          ) : null}
        </div>
      </div>
      
      {/* Export Dialog */}
      <ExportDialog
        showDialog={showExportDialog}
        setShowDialog={setShowExportDialog}
        onExportConfirm={handleExportConfirm}
        isProcessing={exportProcessing}
      />
    </div>
  );
};

export default FaceRecognition;