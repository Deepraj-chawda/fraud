import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, AlertTriangle } from 'lucide-react';
import { ImageFile } from '@/pages/FaceRecognition';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface FaceRecognitionResultsProps {
  results: ImageFile[];
  selectedImage: ImageFile | null;
  onImageSelect: (image: ImageFile) => void;
  threshold: number;
}

const FaceRecognitionResults: React.FC<FaceRecognitionResultsProps> = ({
  results,
  selectedImage,
  onImageSelect,
  threshold
}) => {
  const [activeView, setActiveView] = useState<'grid' | 'split'>('split');
  const inputPanelRef = useRef<HTMLDivElement>(null);
const [showAllMatches, setShowAllMatches] = React.useState<{ [key: string]: boolean }>({});

  // Helper to check if file is a PDF
  const isPdf = (name: string) => name.toLowerCase().endsWith('.pdf');

  // Helper for score indication color
  const getMatchScoreColor = (score: number) => {
    if (score >= threshold + 0.15) return 'bg-green-600 hover:bg-green-700';
    if (score >= threshold) return 'bg-amber-500 hover:bg-amber-600';
    return 'bg-gray-500 hover:bg-gray-600';
  };

  // Truncate file name for display
  const truncateName = (name: string, maxLength: number = 20) => {
    if (name.length <= maxLength) return name;
    return `${name.slice(0, maxLength - 3)}...`;
  };

  // Scroll to the latest result
  useEffect(() => {
    if (results.length > 0 && inputPanelRef.current) {
      const latestResultElement = inputPanelRef.current.querySelector(`[data-id="${results[results.length - 1].id}"]`);
      if (latestResultElement) {
        latestResultElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [results]);

  // Find matched files for the selected file
  const matchedFiles = selectedImage?.matches || [];

  return (
    <div className="space-y-4 animate-fade-in">
      {/* View Control Tabs */}
      <Tabs value={activeView} onValueChange={(value) => setActiveView(value as 'grid' | 'split')} className="w-full">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold mb-2">Recognition Results</h2>
          <TabsList className="overflow-hidden rounded-lg">
            <TabsTrigger value="split">Split View</TabsTrigger>
            <TabsTrigger value="grid">Grid View</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="split" className="mt-4">
          <ResizablePanelGroup direction="horizontal" className="min-h-[600px] rounded-lg border">
            {/* Input Files Panel */}
            <ResizablePanel defaultSize={40} minSize={30}>
              <div className="flex flex-col h-full bg-white" ref={inputPanelRef}>
                <div className="p-4 border-b bg-slate-50">
                  <h3 className="font-medium">Input Files ({results.length})</h3>
                </div>
                <div className="flex-1 overflow-y-auto p-4">
                  <div className="grid grid-cols-2 gap-4">
                    {results.map((file, index) => (
                      <div 
                        key={file.id}
                        data-id={file.id}
                        className={`relative rounded-md overflow-hidden border-2 transition-all cursor-pointer hover:shadow-md ${
                          selectedImage?.id === file.id ? 'border-primary shadow-md' : 'border-transparent'
                        } ${index === results.length - 1 ? 'animate-pulse-bg' : ''}`}
                        onClick={() => onImageSelect(file)}
                      >
                        {isPdf(file.name) ? (
                          <div
                            className="w-full h-40 bg-gray-100 flex flex-col items-center justify-center text-gray-500 text-sm p-2"
                          >
                            <span className="font-medium text-gray-700">PDF</span>
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="text-xs truncate max-w-full">{truncateName(file.name)}</span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>{file.name}</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                        ) : (
                          <img 
                            src={file.url} 
                            alt={file.name}
                            className="w-full h-40 object-cover"
                          />
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 hover:opacity-100 transition-opacity flex items-end">
                          <div className="p-2 w-full">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <p className="text-white text-xs truncate">{truncateName(file.name)}</p>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>{file.name}</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                            <div className="flex gap-1 mt-1">
                              <Badge variant="outline" className="bg-black/30 text-white border-white/20 text-[10px]">
                                {file.matches?.length || 0} match{file.matches?.length === 1 ? '' : 'es'}
                              </Badge>
                            </div>
                          </div>
                        </div>
                        {file.matches && file.matches.length > 0 && (
                          <div className="absolute top-2 right-2">
                            <Badge className="bg-green-600">
                              <CheckCircle className="h-3 w-3 mr-1" />
                              <span className="text-[10px]">Matches</span>
                            </Badge>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </ResizablePanel>

            {/* Resizer Handle */}
            <ResizableHandle withHandle />

            {/* Matches Panel */}
            <ResizablePanel defaultSize={60}>
              <div className="flex flex-col h-full bg-white">
                <div className="p-4 border-b bg-slate-50">
                  <h3 className="font-medium">
                    {selectedImage 
                      ? `Matched Results for "${truncateName(selectedImage.name)}" (${matchedFiles.length})` 
                      : 'Select an input file to see matches'}
                  </h3>
                </div>
                {selectedImage ? (
                  <div className="flex-1 overflow-y-auto p-4">
                    {matchedFiles.length > 0 ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {matchedFiles.map((match) => (
                          <Card key={match.id} className="overflow-hidden hover:shadow-md transition-all flex flex-col h-80">
                            <div className="relative flex-grow">
                              {isPdf(match.name) ? (
                                <div
                                  className="w-full h-full bg-gray-100 flex flex-col items-center justify-center text-gray-500 text-sm p-4"
                                >
                                  <span className="font-medium text-gray-700">PDF</span>
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span className="text-xs truncate max-w-full">{truncateName(match.name)}</span>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        <p>{match.name}</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                </div>
                              ) : (
                                <img 
                                  src={match.url} 
                                  alt={match.name} 
                                  className="w-full h-52 object-fill bg-gray-100"
                                />
                              )}
                              <div className="absolute top-3 right-3">
                                <Badge className={`${getMatchScoreColor(match.score)}`}>
                                  Result: {(match.score).toFixed(2)}
                                </Badge>
                              </div>
                            </div>
                            <CardContent className="p-4 flex-shrink-0">
                              <div className="flex justify-between items-center">
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <p className="font-medium text-sm truncate" title={match.name}>
                                        {truncateName(match.name)}
                                      </p>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <p>{match.name}</p>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              </div>
                              <div className="mt-2">
                                <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                                  <div 
                                    className={`h-full ${getMatchScoreColor(match.score).split(' ')[0]}`}
                                    style={{ width: `${Math.min(match.score, 100)}%` }}
                                  />
                                </div>
                                <div className="flex justify-between mt-1 text-xs text-gray-500">
                                  <span>Threshold: {threshold.toFixed(2)}</span>
                                  <span>Score: {(match.score).toFixed(2)}</span>
                                </div>
                                {/* <div className="flex justify-between mt-1 text-xs text-gray-500">
                                  <span>Distance: {match.distance.toFixed(2)}</span>
                                </div> */}
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    ) : (
                      <div className="h-full flex items-center justify-center">
                        <div className="text-center max-w-md">
                          <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
                          <h4 className="text-lg font-medium">No Matches Found</h4>
                          <p className="text-sm text-muted-foreground mt-2">
                            No matches were found for "{truncateName(selectedImage.name)}" with the current threshold of {threshold.toFixed(2)}.
                            Try lowering the threshold or select another file.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="h-full flex items-center justify-center">
                    <div className="text-center">
                      <p className="text-muted-foreground">Select a file from the left panel to view matches</p>
                    </div>
                  </div>
                )}
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </TabsContent>
        
        <TabsContent value="grid" className="mt-4">
          <Card>
            <CardContent className="p-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {results.map((file, index) => (
                  <Card 
                    key={file.id} 
                    className={`overflow-hidden hover:shadow-md transition-shadow flex flex-col max-h-[400px] ${index === results.length - 1 ? 'animate-pulse-bg' : ''}`}
                  >
                    <div className="p-4 border-b bg-slate-50">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <h4 className="font-medium truncate">{truncateName(file.name)}</h4>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{file.name}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <div className="flex flex-col min-h-0">
                      <div className="relative h-[200px] overflow-hidden">
                        {isPdf(file.name) ? (
                          <div
                            className="w-full h-full bg-gray-100 flex flex-col items-center justify-center text-gray-500 text-sm"
                          >
                            <span className="font-medium text-gray-700">PDF</span>
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="text-xs truncate max-w-full">{truncateName(file.name)}</span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>{file.name}</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                        ) : (
                          <img 
                            src={file.url} 
                            alt={file.name} 
                            className="w-full h-full object-contain bg-gray-100"
                          />
                        )}
                        <div className="absolute top-2 right-2">
                          <Badge className="bg-green-600">
                            <span className="text-xs">{file.matches?.length || 0} match{file.matches?.length === 1 ? '' : 'es'}</span>
                          </Badge>
                        </div>
                      </div>
                      
                      <div className="p-2 flex flex-col min-h-0">
                        {file.matches && file.matches.length > 0 ? (
                          <div className="flex flex-col min-h-0">
                            <h5 className="text-sm font-medium mb-1">Matches:</h5>
                            <div className={`flex flex-col gap-1 ${showAllMatches[file.id] ? 'max-h-[100px] overflow-y-auto' : ''}`}>
                              {file.matches.slice(0, showAllMatches[file.id] ? file.matches.length : 2).map((match) => (
                                <div key={match.id} className="flex items-start gap-2 justify-between bg-slate-50 p-1 rounded">
                                  <div className="w-20 h-10 shrink-0 rounded transition-transform hover:scale-105">
                                    {isPdf(match.name) ? (
                                      <div
                                        className="w-full h-full bg-gray-100 flex flex-col items-center justify-center text-gray-500 text-xs"
                                      >
                                        <span className="font-medium text-gray-700">PDF</span>
                                        <span className="text-[8px] truncate">{truncateName(match.name, 10)}</span>
                                      </div>
                                    ) : (
                                      <img 
                                        src={match.url} 
                                        alt={match.name} 
                                        className="w-full h-full object-contain bg-gray-100"
                                      />
                                    )}
                                  </div>
                                  <div className=" flex flex-row justify-between w-full">                          

                                    <div className="min-w-0 flex-1 flex flex-col">
                                      <TooltipProvider>
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <p className="text-xs truncate ml-2">{truncateName(match.name)}</p>
                                          </TooltipTrigger>
                                          <TooltipContent>
                                            <p>{match.name}</p>
                                          </TooltipContent>
                                        </Tooltip>
                                      </TooltipProvider>
                                      <Badge className={`text-[10px] ${getMatchScoreColor(match.score)} w-fit`}>
                                        {`Score : ${(match.score).toFixed(2)}` }
                                      </Badge>
                                    </div>

                                    <div className="min-w-0 flex-1 flex flex-col">
                                      {/* <TooltipProvider>
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <p className="text-xs truncate ml-2">{`Distnace : ${(match.distance).toFixed(2)}`}</p>
                                            </TooltipTrigger>
                                            <TooltipContent>
                                              <p>{match.distance}</p>
                                            </TooltipContent>
                                          </Tooltip>
                                        </TooltipProvider> */}
                                        {/* <Badge className={`text-[10px] ${getMatchScoreColor(threshold)} w-fit`}>
                                          { `Threshold : ${(threshold).toFixed(2)}` }
                                        </Badge> */}
                                      </div>
                                    </div>
                                  {/* <div className="min-w-0 flex-1 flex flex-col">
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <p className="text-xs truncate">{truncateName(match.name)}</p>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          <p>{match.name}</p>
                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                    <Badge className={`text-[10px] ${getMatchScoreColor(match.score)} w-fit`}>
                                      {(match.score).toFixed(2)}
                                    </Badge>
                                  </div> */}
                                </div>
                              ))}
                            </div>
                            {file.matches.length > 2 && (
                              <div className="text-center mt-1">
                                <button
                                  className="text-xs text-primary hover:underline"
                                  onClick={() => setShowAllMatches(prev => ({
                                    ...prev,
                                    [file.id]: !prev[file.id]
                                  }))}
                                >
                                  {showAllMatches[file.id] ? 'Show Less' : `Show All (+${file.matches.length - 2} more)`}
                                </button>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="flex-grow flex items-center justify-center">
                            <p className="text-sm text-muted-foreground">No matches found</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      
      
      </Tabs>
    </div>
  );
};

// Add CSS for pulse background animation
const styleSheet = document.createElement('style');
styleSheet.textContent = `
  @keyframes pulse-bg {
    0% { background-color: #f0fdf4; }
    50% { background-color: #dcfce7; }
    100% { background-color: #f0fdf4; }
  }
  .animate-pulse-bg {
    animation: pulse-bg 1.5s ease-in-out;
  }
`;
document.head.appendChild(styleSheet);

export default FaceRecognitionResults;