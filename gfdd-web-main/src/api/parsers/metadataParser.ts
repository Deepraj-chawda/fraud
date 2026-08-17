/* eslint-disable @typescript-eslint/no-explicit-any */
export function parseMetadataResponse(response: any) {
  const result: any = {};
  const oddEntries: any = {};
  let createDate = "N/A", modifyDate = "N/A", software = "N/A", fileCreateDate = "N/A", datecreate = "N/A";

  if (typeof response === "object" && !response.html_content) {
    for (const groupName in response) {
      const section = response[groupName];
      if (Array.isArray(section)) {
        section.forEach(([key, value]) => {
          if (key === "CreateDate" && createDate === "N/A") createDate = value;
          else if (key === "Datecreate" && createDate === "N/A") datecreate = value;
          else if (key === "FileCreateDate" && createDate === "N/A") fileCreateDate = value;
          else if (key === "ModifyDate") modifyDate = value;
          else if (key === "Software") software = value;
          if (key.includes("(odd)")) oddEntries[key] = value;
        });
      }
    }

    if (createDate !== "N/A") result["CreateDate"] = createDate;
    else if (datecreate !== "N/A") result["CreateDate"] = datecreate;
    else if (fileCreateDate !== "N/A") result["FileCreateDate"] = fileCreateDate;

    if (modifyDate !== "N/A") result["ModifyDate"] = modifyDate;
    if (software !== "N/A") result["Software"] = software;
  } else if (response.html_content) {
    result["html_content"] = response.html_content;
  }

  return { ...result, ...oddEntries };
}
