import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Upload, CheckCircle, AlertTriangle, Loader, Image as ImageIcon, Folder, File, Download } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import UploadModal from '@/components/UploadModal';
import { detectAISingle, detectAIImages } from '@/api/services/aiDetection';
import { isAuthenticated } from '@/api/auth';
import { useNavigate } from 'react-router-dom';

type UploadMode = 'single' | 'multiple';
type DetectionResult = 'ai' | 'human' | 'pending' | null;

interface ProcessedFile {
  id: string;
  file: File;
  url: string;
  result: DetectionResult;
  humanProbability?: number; 
  aiProbability?: number;   
}

const AIDetection: React.FC = () => {
  const [uploadMode, setUploadMode] = useState<UploadMode>('single');
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const [processedFiles, setProcessedFiles] = useState<ProcessedFile[]>([]);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  // Reset processed files when upload mode changes
  useEffect(() => {
    setProcessedFiles([]);
  }, [uploadMode]);

  // useEffect(() => {
  //     if (!isAuthenticated()) {
  //       toast({
  //         title: "Authentication required",
  //         description: "Please log in to access this page",
  //         variant: "destructive",
  //       });
  //       navigate("/login");
  //     }
  //   }, [navigate, toast]);

  const getFileUrl = (file: File): string => {
    return URL.createObjectURL(file);
  };

  const handleUploadFiles = (files: File[]) => {
    // Validate files
    const validFiles = files.filter(file => file.type.startsWith('image/'));
    if (validFiles.length === 0) {
      toast({
        title: "Error",
        description: "No valid images selected",
        variant: "destructive",
      });
      return;
    }

    // For single mode, only take the first file
    const selectedFiles = uploadMode === 'single' 
      ? [validFiles[0]] 
      : validFiles;
    
    // Reset state for new uploads
    setProcessedFiles([]);
    setIsProcessing(true);
    setProcessingProgress(0);
    setCurrentFileIndex(0);

    // Create initial processed files array with pending status
    const initialFiles = selectedFiles.map((file, index) => ({
      id: `file-${Date.now()}-${index}`,
      file,
      url: getFileUrl(file),
      result: 'pending' as DetectionResult,
    }));

    setProcessedFiles(initialFiles);

    // Process files
    processFiles(initialFiles);
    
    // Show toast notification
    toast({
      title: `Analyzing ${selectedFiles.length} ${selectedFiles.length === 1 ? 'image' : 'images'}`,
      description: "Processing has started"
    });
  };

  const processFiles = async (files: ProcessedFile[]) => {
    const totalFiles = files.length;

    if (uploadMode === 'single') {
      // Single image processing
      try {
        setProcessingProgress(50); // Start progress
        const apiResponse = await detectAISingle(files[0].file);
        const result = apiResponse.result;
        const humanProbability = Math.round(apiResponse.human_probability * 100 * 100) / 100;
        const aiProbability = Math.round(apiResponse.ai_probability * 100 * 100) / 100;

        setProcessedFiles(prev =>
          prev.map((file, idx) =>
            idx === 0
              ? { ...file, result, humanProbability, aiProbability }
              : file
          )
        );
        setProcessingProgress(100);
        toast({
          title: "Analysis Complete",
          description: "Image analyzed successfully",
        });
      } catch (error) {
        console.error('Error processing file:', error);
        setProcessedFiles(prev =>
          prev.map((file, idx) =>
            idx === 0
              ? { ...file, result: null, humanProbability: 0, aiProbability: 0 }
              : file
          )
        );
        toast({
          title: "Error",
          description: `Failed to analyze ${files[0].file.name}: ${error instanceof Error ? error.message : 'Unknown error'}`,
          variant: "destructive",
        });
      } finally {
        setIsProcessing(false);
      }
    } else {
      // Multiple image processing
      try {
        // Simulate progress animation
        let progress = 0;
        const progressInterval = setInterval(() => {
          progress = Math.min(progress + 10, 80);
          setProcessingProgress(progress);
        }, 10);

        const apiResponse = await detectAIImages(files.map(f => f.file));
        clearInterval(progressInterval);
        setProcessingProgress(100);

        // Map API results to processed files
        const updatedFiles = files.map((file) => {
          const detection = apiResponse.images.find(res => res.filename === file.file.name);
          const error = apiResponse.error_images.find(err => err.filename === file.file.name);
          if (error) {
            return {
              ...file,
              result: null,
              humanProbability: 0,
              aiProbability: 0,
            };
          }
          return {
            ...file,
            result: detection?.result || null,
            humanProbability: detection ? Math.round(detection.human_probability * 100 * 100) / 100 : 0,
            aiProbability: detection ? Math.round(detection.ai_probability * 100 * 100) / 100 : 0,
          };
        });

        setProcessedFiles(updatedFiles);
        setCurrentFileIndex(totalFiles - 1); // Reflect all files processed

        // Show toasts for results and errors
        toast({
          title: "Analysis Complete",
          description: `Analyzed ${apiResponse.total_files} ${apiResponse.total_files === 1 ? 'image' : 'images'} successfully`,
        });

        if (apiResponse.error_images.length > 0) {
          toast({
            title: "Some images failed",
            description: `${apiResponse.error_images.length} image(s) could not be processed`,
            variant: "destructive",
          });
        }
      } catch (error) {
        console.error('Error processing files:', error);
        setProcessedFiles(files.map(file => ({
          ...file,
          result: null,
          humanProbability: 0,
          aiProbability: 0,
        })));
        toast({
          title: "Error",
          description: `Failed to analyze images: ${error instanceof Error ? error.message : 'Unknown error'}`,
          variant: "destructive",
        });
      } finally {
        setIsProcessing(false);
        setProcessingProgress(100);
      }
    }
  };

  const handleExportCSV = () => {
    // Filter files with valid results
    const validFiles = processedFiles.filter(file => file.result && file.result !== 'pending');
    
    if (validFiles.length === 0) {
      toast({
        title: "No Results to Export",
        description: "Please analyze images before exporting results",
        variant: "destructive",
      });
      return;
    }

    // CSV header
    const headers = ['filename', 'result', 'human_probability', 'ai_probability'];
    const csvRows = [headers.join(',')];

    // Add data rows
    validFiles.forEach(file => {
      const filename = `"${file.file.name.replace(/"/g, '""')}"`; // Escape quotes in filename
      const row = [
        filename,
        file.result || 'N/A',
        // Convert percentages back to decimals for CSV
        file.humanProbability !== undefined ? (file.humanProbability / 100).toString() : '0',
        file.aiProbability !== undefined ? (file.aiProbability / 100).toString() : '0',
      ];
      csvRows.push(row.join(','));
    });

    // Create CSV content
    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'ai_detection_results.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast({
      title: "Export Successful",
      description: "Results have been exported as CSV",
    });
  };

  const handleUploadClick = () => {
    setShowUploadModal(true);
  };

  const handleUploadComplete = (files: File[]) => {
    handleUploadFiles(files);
  };

  // Get filename without path for display
  const getFilenameWithoutPath = (filename: string) => {
    return filename.split('\\').pop()?.split('/').pop() || filename;
  };

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      {/* Page Header */}
      <div className="border-b bg-white p-4 flex justify-between items-center shadow-sm">
        <h1 className="text-2xl font-bold text-foreground">AI Integrity Check</h1>
        <div className="flex gap-2">
          <Button 
            onClick={handleUploadClick}
            className="w-full sm:w-auto"
            disabled={isProcessing}
          >
            <Upload className="mr-2 h-4 w-4" />
            Upload Images
          </Button>
          <Button 
            onClick={handleExportCSV}
            variant="outline"
            className="w-full sm:w-auto"
            disabled={isProcessing || processedFiles.length === 0}
          >
            <Download className="mr-2 h-4 w-4" />
            Export Results
          </Button>
        </div>
      </div>

      <div className="flex-1 p-4 md:p-6 mx-auto w-full">
        {/* Main Content Card */}
        <Card className="bg-white overflow-hidden shadow-md">
          <CardContent className="p-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
              <div>
                <h2 className="text-xl font-medium">AI Detection Analysis</h2>
                <p className="text-sm text-gray-500 mt-1">
                  Upload an image or a folder of images to detect whether they are AI-generated
                </p>
              </div>
              
              {/* Upload Button (Moved to Header) */}
            </div>
            
            {/* Upload Mode Selection */}
            <Tabs 
              value={uploadMode} 
              onValueChange={(value) => setUploadMode(value as UploadMode)}
              className="mt-6"
            >
              <div className="mx-auto max-w-md">
                <TabsList className="w-full mb-6 grid grid-cols-2 bg-slate-100/70 p-1.5 rounded-lg">
                  <TabsTrigger value="single" className="flex items-center justify-center gap-2 py-3 rounded-lg">
                    <File className="h-4 w-4" />
                    Single Image
                  </TabsTrigger>
                  <TabsTrigger value="multiple" className="flex items-center justify-center gap-2 py-3 rounded-lg">
                    <Folder className="h-4 w-4" />
                    Image Folder
                  </TabsTrigger>
                </TabsList>
              </div>

              {/* Processing Indicator */}
              {isProcessing && (
                <div className="mb-8 p-4 border rounded-lg bg-slate-50 shadow-inner">
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <h3 className="text-sm font-medium text-gray-700">Analyzing Images</h3>
                      <span className="text-xs text-gray-500">
                        {currentFileIndex + 1} of {processedFiles.length}
                      </span>
                    </div>
                    
                    <Progress value={processingProgress} className="h-2" />
                    
                    {uploadMode === 'multiple' && processedFiles.length > 1 && (
                      <p className="text-xs text-gray-600">
                        Processing image {currentFileIndex + 1} of {processedFiles.length}...
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Tab Contents */}
              <TabsContent value="single" className="mt-0">
                {processedFiles.length > 0 && uploadMode === 'single' ? (
                  <div className="mt-4">
                    <Card className="overflow-hidden border shadow-sm">
                      <div className="flex flex-col md:flex-row">
                        {/* Image Preview Side */}
                        <div className="md:w-1/2 h-[350px] md:h-[450px] relative overflow-hidden bg-slate-100">
                          <img 
                            src={processedFiles[0].url} 
                            alt="Analyzed image" 
                            className="w-full h-full object-contain"
                          />
                          {processedFiles[0].result === 'pending' && (
                            <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                              <Loader className="h-6 w-6 text-white animate-spin" />
                            </div>
                          )}
                        </div>
                        
                        {/* Results Side */}
                        <div className="md:w-1/2 p-6 flex flex-col">
                          <h3 className="text-xl font-semibold mb-4">Analysis Result</h3>
                          
                          {processedFiles[0].result === 'pending' ? (
                            <div className="flex items-center gap-3 mt-4">
                              <Loader className="h-6 w-6 animate-spin text-primary" />
                              <p>Analyzing image...</p>
                            </div>
                          ) : (
                            <div className={`mt-2 p-6 rounded-lg ${
                              processedFiles[0].result === 'human' 
                                ? 'bg-green-50 border border-green-200' 
                                : 'bg-red-50 border border-red-200'
                            }`}>
                              {processedFiles[0].result === 'human' ? (
                                <div className="flex items-center gap-3">
                                  <CheckCircle className="h-8 w-8 text-green-600" />
                                  <div>
                                    <p className="font-semibold text-lg text-green-600">This image is NOT AI-generated</p>
                                    <p className="text-sm text-green-700 mt-1">
                                      Human Probability: {processedFiles[0].humanProbability}%
                                    </p>
                                    <p className="text-sm text-green-700 mt-1">
                                      AI Probability: {processedFiles[0].aiProbability}%
                                    </p>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex items-center gap-3">
                                  <AlertTriangle className="h-8 w-8 text-red-600" />
                                  <div>
                                    <p className="font-semibold text-lg text-red-600">This image is AI-generated</p>
                                    <p className="text-sm text-red-700 mt-1">
                                      Human Probability: {processedFiles[0].humanProbability}%
                                    </p>
                                    <p className="text-sm text-red-700 mt-1">
                                      AI Probability: {processedFiles[0].aiProbability}%
                                    </p>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                          
                          <div className="mt-8 space-y-4">
                            <h4 className="font-medium text-gray-800">Image Details</h4>
                            <div className="grid grid-cols-1 gap-2 text-sm">
                              <div className="flex justify-between py-2 px-4 bg-slate-50 rounded-md">
                                <span className="text-gray-600">Filename:</span>
                                <span className="font-medium">{getFilenameWithoutPath(processedFiles[0].file.name)}</span>
                              </div>
                              <div className="flex justify-between py-2 px-4 bg-slate-50 rounded-md">
                                <span className="text-gray-600">File size:</span>
                                <span className="font-medium">{Math.round(processedFiles[0].file.size / 1024)} KB</span>
                              </div>
                              <div className="flex justify-between py-2 px-4 bg-slate-50 rounded-md">
                                <span className="text-gray-600">File type:</span>
                                <span className="font-medium">{processedFiles[0].file.type}</span>
                              </div>
                            </div>
                          </div>
                          
                          <div className="mt-auto pt-6">
                            <Button 
                              onClick={handleUploadClick}
                              variant="outline"
                              className="w-full sm:w-auto"
                              disabled={isProcessing}
                            >
                              Analyze Another Image
                            </Button>
                          </div>
                        </div>
                      </div>
                    </Card>
                  </div>
                ) : !isProcessing && (
                  <EmptyStateView onUpload={handleUploadClick} />
                )}
              </TabsContent>
              
              <TabsContent value="multiple" className="mt-0">
                {processedFiles.length > 0 && uploadMode === 'multiple' ? (
                  <div className="mt-4">
                    <h3 className="text-lg font-medium mb-4">Detection Results</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                      {processedFiles.map((file) => (
                        <Card key={file.id} className="overflow-hidden hover:shadow-md transition-all duration-300">
                          <div className="h-56 relative overflow-hidden bg-slate-100">
                            <img 
                              src={file.url} 
                              alt="Analyzed image" 
                              className="w-full h-full object-fill"
                            />
                            {file.result && file.result !== 'pending' && (
                              <Badge 
                                className={`absolute top-3 right-3 ${
                                  file.result === 'human' 
                                    ? 'bg-green-600 hover:bg-green-700' 
                                    : 'bg-red-600 hover:bg-red-700'
                                }`}
                              >
                                {file.result === 'human' ? 'Human-Generated' : 'AI-Generated'}
                              </Badge>
                            )}
                            {file.result === 'pending' && (
                              <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                                <Loader className="h-6 w-6 text-white animate-spin" />
                              </div>
                            )}
                          </div>
                          <CardContent className="p-4">
                            <div className="flex items-center gap-2 mb-2">
                              <ImageIcon className="h-6 w-6 text-blue-500" />
                              <p className="text-sm font-medium truncate" title={file.file.name}>
                                {getFilenameWithoutPath(file.file.name)}
                              </p>
                            </div>
                            
                            {file.result === 'pending' ? (
                              <p className="text-sm text-gray-500 mt-1">Analyzing...</p>
                            ) : (
                              <div className="space-y-1 mt-2">
                                <div className="flex items-center gap-1.5">
                                  {file.result === 'human' ? (
                                    <CheckCircle className="h-4 w-4 text-green-600" />
                                  ) : (
                                    <AlertTriangle className="h-4 w-4 text-red-600" />
                                  )}
                                  <span className={`text-sm font-medium ${
                                    file.result === 'human' ? 'text-green-600' : 'text-red-600'
                                  }`}>
                                    {file.result === 'human' ? 'Human-Generated' : 'AI-Generated'}
                                  </span>
                                </div>
                                <p className="text-xs text-gray-500">
                                  Human Probability: {file.humanProbability}%
                                </p>
                                <p className="text-xs text-gray-500">
                                  AI Probability: {file.aiProbability}%
                                </p>
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                    
                    {/* Action Button for Multiple Analysis */}
                    {!isProcessing && (
                      <div className="mt-6 flex justify-center">
                        <Button 
                          onClick={handleUploadClick}
                          variant="outline"
                        >
                          Analyze More Images
                        </Button>
                      </div>
                    )}
                  </div>
                ) : !isProcessing && (
                  <EmptyStateView onUpload={handleUploadClick} />
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
      
      {/* Upload Modal */}
      <UploadModal 
        open={showUploadModal} 
        onOpenChange={setShowUploadModal} 
        onUploadComplete={handleUploadComplete}
        uploadMode={uploadMode}
      />
    </div>
  );
};

// Empty state component
const EmptyStateView = ({ onUpload }: { onUpload: () => void }) => (
  <div className="py-10 flex flex-col items-center text-center max-w-md mx-auto">
    <div className="bg-slate-50 p-4 rounded-full mb-4">
      <Folder className="h-10 w-10 text-slate-400" />
    </div>
    <h3 className="text-lg font-medium mt-2">No Images Selected</h3>
    <p className="text-gray-500 my-3 text-sm">
      Upload an image or a folder of images to analyze whether they're AI-generated or human-created.
    </p>
    <Button onClick={onUpload} className="mt-2">
      <Upload className="mr-2 h-4 w-4" />
      Upload Images
    </Button>
  </div>
);

export default AIDetection;