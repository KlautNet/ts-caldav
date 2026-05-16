import { XMLParser } from "fast-xml-parser";

export type DavNode = Record<string, unknown>;

export const parseDavXml = (xml: string): DavNode => {
  const parser = new XMLParser({
    removeNSPrefix: true,
    ignoreAttributes: false,
    attributeNamePrefix: "",
  });
  return parser.parse(xml) as DavNode;
};

export const toArray = <T>(value: T | T[] | null | undefined): T[] => {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
};

export const asNode = (value: unknown): DavNode | undefined => {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as DavNode)
    : undefined;
};

export const asString = (value: unknown): string | undefined => {
  if (typeof value === "string") return value;

  const node = asNode(value);
  const text = node?.["#text"];
  return typeof text === "string" ? text : undefined;
};

export type DavPropstat = {
  status?: string;
  prop: DavNode;
};

export type DavResponse = {
  href?: string;
  propstats: DavPropstat[];
};

export const getDavResponses = (parsed: unknown): DavResponse[] => {
  const root = asNode(parsed);
  const multistatus = asNode(root?.multistatus);
  const responses = toArray(multistatus?.response);

  return responses.flatMap((response) => {
    const responseNode = asNode(response);
    if (!responseNode) return [];

    const propstats = toArray(responseNode.propstat).flatMap((propstat) => {
      const propstatNode = asNode(propstat);
      const prop = asNode(propstatNode?.prop);
      if (!prop) return [];

      return {
        status: asString(propstatNode?.status),
        prop,
      };
    });

    return {
      href: asString(responseNode.href),
      propstats,
    };
  });
};

export const isSuccessfulPropstat = (propstat: DavPropstat): boolean => {
  return (
    !propstat.status ||
    propstat.status.toLowerCase().includes(" 200 ") ||
    propstat.status.toLowerCase().endsWith(" 200 ok")
  );
};

export const getSuccessfulPropstats = (
  response: DavResponse,
): DavPropstat[] => {
  return response.propstats.filter(isSuccessfulPropstat);
};

export const getFirstSuccessfulProp = (
  response: DavResponse,
): DavNode | undefined => {
  return getSuccessfulPropstats(response)[0]?.prop;
};
