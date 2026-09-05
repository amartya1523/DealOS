import { useState } from 'react';
import { AlertTriangle, UserRoundCog, UsersRound } from 'lucide-react';
import type { Customer } from '../../api';
import { CustomerAssignmentDialog } from './CustomerAssignmentDialog';
import './customer-relationships.css';

const assignedDate = (value?: string) => value ? new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value)) : 'Not assigned';

export function CustomerRelationshipCard({ customer, canChange, onChanged }: { customer: Customer; canChange: boolean; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const unassigned = !customer.primaryTeam || !customer.primaryRepresentative;
  return <>
    <section className="customer-relationship-card">
      <div className="relationship-card-head"><div><span>Account ownership</span><h3>Sales relationship</h3></div>{canChange&&<button className="button ghost" onClick={()=>setEditing(true)}><UserRoundCog/>Change assignment</button>}</div>
      {unassigned&&<div className="relationship-warning"><AlertTriangle/><span><b>Assignment required</b>This account cannot be selected by a representative until a primary team and representative are assigned.</span></div>}
      <dl className="relationship-facts">
        <div><dt>Primary sales team</dt><dd>{customer.primaryTeam?.name??'Unassigned'}</dd></div>
        <div><dt>Primary representative</dt><dd>{customer.primaryRepresentative?.name??'Unassigned'}<small>Since {assignedDate(customer.primaryRepresentative?.assignedAt)}</small></dd></div>
        <div><dt>Collaborators</dt><dd>{customer.collaborators?.length?<span className="relationship-people">{customer.collaborators.map(person=><em key={person.id}>{person.name}</em>)}</span>:<span className="relationship-empty"><UsersRound/>None</span>}</dd></div>
        <div><dt>Open quotations</dt><dd>{customer.openQuotationCount??customer.quotes?.filter(quote=>!['CONFIRMED','REJECTED'].includes(quote.stage)).length??0}</dd></div>
      </dl>
    </section>
    {editing&&<CustomerAssignmentDialog customer={customer} close={()=>setEditing(false)} onChanged={onChanged}/>} 
  </>;
}
