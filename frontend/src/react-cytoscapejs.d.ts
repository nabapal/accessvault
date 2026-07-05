declare module "react-cytoscapejs" {
  import { Component, CSSProperties } from "react";
  import type { Core, ElementDefinition } from "cytoscape";

  interface CytoscapeComponentProps {
    elements: ElementDefinition[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    stylesheet?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    layout?: any;
    style?: CSSProperties;
    className?: string;
    cy?: (cy: Core) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  }

  export default class CytoscapeComponent extends Component<CytoscapeComponentProps> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    static normalizeElements(data: any): ElementDefinition[];
  }
}
