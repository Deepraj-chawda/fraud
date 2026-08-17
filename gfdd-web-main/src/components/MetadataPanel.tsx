
import React from 'react';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface MetadataItem {
  label: string;
  value: string | number;
}

interface MetadataPanelProps {
  imageData?: {
    filename: string;
    filesize: string;
    dimensions: string;
    created: string;
    modified: string;
    format: string;
    colorSpace: string;
    exif?: {
      camera: string;
      focalLength: string;
      aperture: string;
      exposureTime: string;
      iso: string;
      gps?: string;
    };
    tags?: string[];
  };
  exifApiData?: Record<string, string> | null;
  headerApiData?: Record<string, string> | null;
}

const MetadataPanel: React.FC<MetadataPanelProps> = ({ 
  imageData, 
  exifApiData, 
  headerApiData 
}) => {
  if (!imageData) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <p className="text-slate-400 text-center">Select an image to view metadata</p>
      </div>
    );
  }

  const renderSection = (title: string, items: MetadataItem[]) => (
    <div className="metadata-section transition-all hover:shadow-sm animate-fade-in">
      <h3 className="font-medium text-slate-700 mb-2">{title}</h3>
      <div className="space-y-2">
        {items.map((item, index) => (
          <div key={index} className="grid grid-cols-2 gap-1">
            <span className="metadata-label">{item.label}:</span>
            <span className="metadata-value">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );

  const renderApiData = (data: Record<string, string> | null | undefined, title: string) => {
    if (!data) {
      return (
        <div className="flex items-center justify-center h-40">
          <p className="text-slate-400">No {title} data available</p>
        </div>
      );
    }

    return (
      <div className="overflow-auto max-h-[400px]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-1/3">Property</TableHead>
              <TableHead>Value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Object.entries(data).map(([key, value], index) => (
              <TableRow key={index} className={key.includes('(odd)') ? 'bg-amber-50' : ''}>
                <TableCell className="font-medium">{key}</TableCell>
                <TableCell>{value}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  };

  // Determine if we have API data to show
  const hasApiData = exifApiData || headerApiData;

  return (
    <div className="h-full overflow-y-auto p-4 animate-fade-in">
      <h2 className="text-lg font-semibold mb-4">Image Metadata</h2>
      
      <div className="mb-4">
        <h3 className="font-bold text-slate-700 truncate">{imageData.filename}</h3>
        <p className="text-sm text-slate-500">{imageData.filesize}</p>
      </div>
      
      <Separator className="my-4" />
      
      {hasApiData ? (
        <Tabs defaultValue="api" className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-4">
            <TabsTrigger value="api">API Metadata</TabsTrigger>
            <TabsTrigger value="file">File Info</TabsTrigger>
          </TabsList>
          
          <TabsContent value="api" className="space-y-4">
            <Tabs defaultValue="exif">
              <TabsList className="w-full">
                <TabsTrigger value="exif" className="flex-1">EXIF Data</TabsTrigger>
                <TabsTrigger value="header" className="flex-1">Header Structure</TabsTrigger>
              </TabsList>
              
              <TabsContent value="exif">
                {renderApiData(exifApiData, "EXIF")}
              </TabsContent>
              
              <TabsContent value="header">
                {renderApiData(headerApiData, "Header Structure")}
              </TabsContent>
            </Tabs>
          </TabsContent>
          
          <TabsContent value="file">
            {renderSection("File Information", [
              { label: "Dimensions", value: imageData.dimensions },
              { label: "Created", value: imageData.created },
              { label: "Modified", value: imageData.modified },
              { label: "Format", value: imageData.format },
              { label: "Color Space", value: imageData.colorSpace },
            ])}
            
            {imageData.exif && (
              renderSection("Camera Information", [
                { label: "Camera", value: imageData.exif.camera },
                { label: "Focal Length", value: imageData.exif.focalLength },
                { label: "Aperture", value: imageData.exif.aperture },
                { label: "Exposure Time", value: imageData.exif.exposureTime },
                { label: "ISO", value: imageData.exif.iso },
                ...(imageData.exif.gps ? [{ label: "GPS Location", value: imageData.exif.gps }] : []),
              ])
            )}
            
            {imageData.tags && imageData.tags.length > 0 && (
              <div className="metadata-section animate-fade-in">
                <h3 className="font-medium text-slate-700 mb-2">Tags</h3>
                <div className="flex flex-wrap gap-2">
                  {imageData.tags.map((tag, index) => (
                    <span 
                      key={index} 
                      className="px-2 py-1 text-xs bg-primary/10 text-primary-foreground rounded-full transition-transform hover:scale-105"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      ) : (
        <>
          {renderSection("File Information", [
            { label: "Dimensions", value: imageData.dimensions },
            { label: "Created", value: imageData.created },
            { label: "Modified", value: imageData.modified },
            { label: "Format", value: imageData.format },
            { label: "Color Space", value: imageData.colorSpace },
          ])}
          
          {imageData.exif && (
            renderSection("Camera Information", [
              { label: "Camera", value: imageData.exif.camera },
              { label: "Focal Length", value: imageData.exif.focalLength },
              { label: "Aperture", value: imageData.exif.aperture },
              { label: "Exposure Time", value: imageData.exif.exposureTime },
              { label: "ISO", value: imageData.exif.iso },
              ...(imageData.exif.gps ? [{ label: "GPS Location", value: imageData.exif.gps }] : []),
            ])
          )}
          
          {imageData.tags && imageData.tags.length > 0 && (
            <div className="metadata-section animate-fade-in">
              <h3 className="font-medium text-slate-700 mb-2">Tags</h3>
              <div className="flex flex-wrap gap-2">
                {imageData.tags.map((tag, index) => (
                  <span 
                    key={index} 
                    className="px-2 py-1 text-xs bg-primary/10 text-primary-foreground rounded-full transition-transform hover:scale-105"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default MetadataPanel;
